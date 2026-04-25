import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import fs from 'fs';
import path from 'path';

export class OpenAIRealtimeService {
  constructor(ws) {
    this.ws = ws;
    this.callSid = null;
    this.callerId = null;
    this.mode = 'inbound';
    this.openaiWs = null;
    this.streamSid = null;
    this.isOpenAiConnected = false;
    this.isTwilioStarted = false;
  }

  async connect() {
    try {
      this.openaiWs = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01', {
        headers: {
          'Authorization': `Bearer ${config.openai.apiKey}`,
          'OpenAI-Beta': 'realtime=v1',
        },
      });

      this.openaiWs.on('open', () => {
        logger.info('Connected to OpenAI Realtime API');
        this.isOpenAiConnected = true;
        this.checkAndInitializeSession();
      });

      this.openaiWs.on('message', (data) => {
        this.handleOpenAIMessage(data);
      });

      this.openaiWs.on('error', (error) => {
        logger.error('OpenAI WebSocket Error:', error);
      });

      this.openaiWs.on('close', () => {
        logger.info('OpenAI WebSocket Closed');
      });

    } catch (error) {
      logger.error('Error connecting to OpenAI:', error);
    }
  }

  checkAndInitializeSession() {
    if (this.isOpenAiConnected && this.isTwilioStarted) {
      this.sendSessionUpdate();
    }
  }

  sendSessionUpdate() {
    const sessionUpdate = {
      type: 'session.update',
      session: {
        turn_detection: { type: 'server_vad', silence_duration_ms: 1500 },
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        voice: 'coral',
        instructions: prompts.systemInstruction,
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Schedule a Technical Assessment with a human specialist. Use this when the client agrees to an appointment.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the person scheduling the appointment" },
                companyName: { type: "string", description: "Name of the company" },
                confirmedPhone: { type: "string", description: "The best phone number to call them back on" },
                appointmentTime: { type: "string", description: "The exact time tomorrow for the appointment" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Log the interaction if the client is not interested, asks to call back later, or if you reach a voicemail.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Reason for the report (e.g., Not interested, Voicemail, Call back later)" },
                details: { type: "string", description: "Any additional details or context from the call" }
              },
              required: ["reason"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the conversation naturally. Use this tool only when it is time to say goodbye and hang up.",
            parameters: {
              type: "object",
              properties: {},
            }
          }
        ],
        tool_choice: "auto"
      },
    };
    this.sendToOpenAI(sessionUpdate);
  }

  async handleOpenAIMessage(data) {
    try {
      const event = JSON.parse(data);

      if (event.type === 'session.created') {
        logger.info('OpenAI Session Created');
      }

      if (event.type === 'response.audio.delta' && event.delta) {
        this.sendAudioToTwilio(event.delta);
      }

      if (event.type === 'response.audio_transcript.done') {
          logConversation(this.callSid, 'Assistant', event.transcript);
      }

      if (event.type === 'conversation.item.input_audio_transcription.completed') {
          logConversation(this.callSid, 'User', event.transcript);
      }

      if (event.type === 'response.function_call_arguments.done') {
        await this.handleFunctionCall(event);
      }

    } catch (error) {
      logger.error('Error parsing OpenAI message:', error);
    }
  }

  async handleFunctionCall(event) {
    const { name, arguments: args } = event;
    const callId = event.call_id;
    let parsedArgs = {};

    logger.info(`Function call detected: ${name} with args: ${args}`);

    try {
      parsedArgs = JSON.parse(args);
    } catch (e) {
      logger.error(`Error parsing args for ${name}:`, e);
      return;
    }

    let result = null;

    try {
      if (name === 'schedule_appointment') {
        const lead = {
          callSid: this.callSid,
          callerId: this.callerId,
          contactName: parsedArgs.contactName,
          companyName: parsedArgs.companyName,
          confirmedPhone: parsedArgs.confirmedPhone,
          appointmentTime: parsedArgs.appointmentTime,
          timestamp: new Date().toISOString()
        };

        const leadsPath = path.join(process.cwd(), 'src', 'data', 'leads.json');
        const leads = JSON.parse(fs.readFileSync(leadsPath, 'utf8'));
        leads.push(lead);
        fs.writeFileSync(leadsPath, JSON.stringify(leads, null, 2));

        const { sendEmail } = await import('./emailService.js');
        await sendEmail('SUCCESS', lead);

        result = { status: 'success', message: 'Appointment scheduled successfully.' };

      } else if (name === 'report_interaction') {
        const interaction = {
          callSid: this.callSid,
          callerId: this.callerId,
          reason: parsedArgs.reason,
          details: parsedArgs.details || '',
          timestamp: new Date().toISOString()
        };

        const interactionsPath = path.join(process.cwd(), 'src', 'data', 'interactions.json');
        const interactions = JSON.parse(fs.readFileSync(interactionsPath, 'utf8'));
        interactions.push(interaction);
        fs.writeFileSync(interactionsPath, JSON.stringify(interactions, null, 2));

        const { sendEmail } = await import('./emailService.js');
        await sendEmail('REPORT', interaction);

        result = { status: 'success', message: 'Interaction logged.' };

      } else if (name === 'end_call') {
        result = { status: 'ending' };

        // Return function output to prevent model hang
        const functionOutput = {
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: callId,
            output: JSON.stringify(result)
          }
        };
        this.sendToOpenAI(functionOutput);

        // Instruct OpenAI to say goodbye
        this.sendToOpenAI({
          type: 'response.create',
          response: {
            instructions: "Say a short, polite goodbye and nothing else."
          }
        });

        // Close after 10 seconds
        setTimeout(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.close();
          }
        }, 10000);
        return; // Early return because we handled the output above
      }

      if (result) {
        const functionOutput = {
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: callId,
            output: JSON.stringify(result)
          }
        };
        this.sendToOpenAI(functionOutput);
        this.sendToOpenAI({ type: 'response.create' });
      }

    } catch (error) {
      logger.error(`Error executing function ${name}:`, error);

      const functionOutput = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify({ status: 'error', message: error.message })
        }
      };
      this.sendToOpenAI(functionOutput);
      this.sendToOpenAI({ type: 'response.create' });
    }
  }

  sendAudioToTwilio(audioPayload) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.streamSid) {
      const audioDelta = {
        event: 'media',
        streamSid: this.streamSid,
        media: {
          payload: audioPayload
        }
      };
      this.ws.send(JSON.stringify(audioDelta));
    }
  }

  sendToOpenAI(data) {
    if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
      this.openaiWs.send(JSON.stringify(data));
    }
  }

  handleTwilioMedia(data) {
    if (data.event === 'start') {
      this.streamSid = data.start.streamSid;
      logger.info(`Stream started: ${this.streamSid}`);
      this.isTwilioStarted = true;
      this.checkAndInitializeSession();
    } else if (data.event === 'media') {
        const audioAppend = {
            type: 'input_audio_buffer.append',
            audio: data.media.payload
        };
        this.sendToOpenAI(audioAppend);
    }
  }
}
