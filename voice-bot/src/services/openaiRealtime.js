import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendAppointmentEmail, sendReportEmail } from './emailService.js';

export class OpenAIRealtimeService {
  constructor(ws, callSid, mode, callerId) {
    this.ws = ws;
    this.callSid = callSid;
    this.mode = mode;
    this.callerId = callerId;
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
    const instructions = this.mode === 'outbound' ? prompts.SARAH_OUTBOUND : prompts.SARAH_INBOUND;

    const sessionUpdate = {
      type: 'session.update',
      session: {
        turn_detection: {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 1500
        },
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        voice: 'coral',
        instructions: instructions,
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Schedule a technical assessment when the user says YES to the pitch. Only call this when you have collected contactName, companyName, confirmedPhone, and appointmentTime (The Trifecta + Time).",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the person to ask for" },
                companyName: { type: "string", description: "Name of the company" },
                confirmedPhone: { type: "string", description: "Verbal confirmed best phone number to call" },
                appointmentTime: { type: "string", description: "Exact date and time for the technical assessment" },
                needs: { type: "string", description: "Brief summary of detected needs (e.g. Internet, VoIP, IT)" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime", "needs"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Log the interaction if the client is not interested, asks to call back later, or it goes to voicemail.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Short reason like 'Not Interested', 'Call Back Later', or 'Voicemail'" },
                notes: { type: "string", description: "Any brief notes about the interaction" }
              },
              required: ["reason"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call and hang up the connection.",
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

    // If outbound, force the AI to speak first immediately
    if (this.mode === 'outbound') {
       this.sendToOpenAI({
         type: 'response.create',
         response: {
             instructions: "Start the conversation immediately by executing your Gatekeeper Navigation step."
         }
       });
    }
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

    logger.info(`Function call detected: ${name} with args: ${args}`);
    let result = null;
    let parsedArgs;

    try {
        parsedArgs = JSON.parse(args);
    } catch (e) {
        logger.error(`Failed to parse arguments for ${name}:`, e);
        parsedArgs = {};
    }

    try {
      if (name === 'schedule_appointment') {
        const lead = {
            id: Date.now().toString(),
            timestamp: new Date().toISOString(),
            callerId: this.callerId,
            callSid: this.callSid,
            ...parsedArgs
        };

        const leadsPath = path.resolve('src/data/leads.json');
        const leads = JSON.parse(fs.readFileSync(leadsPath, 'utf8'));
        leads.push(lead);
        fs.writeFileSync(leadsPath, JSON.stringify(leads, null, 2));

        await sendAppointmentEmail({ ...parsedArgs, callerId: this.callerId });
        result = { success: true, message: "Appointment saved successfully." };

      } else if (name === 'report_interaction') {
        const interaction = {
            id: Date.now().toString(),
            timestamp: new Date().toISOString(),
            callerId: this.callerId,
            callSid: this.callSid,
            ...parsedArgs
        };

        const interactionsPath = path.resolve('src/data/interactions.json');
        const interactions = JSON.parse(fs.readFileSync(interactionsPath, 'utf8'));
        interactions.push(interaction);
        fs.writeFileSync(interactionsPath, JSON.stringify(interactions, null, 2));

        await sendReportEmail({ ...parsedArgs, callerId: this.callerId });
        result = { success: true, message: "Interaction logged successfully." };

      } else if (name === 'end_call') {
        result = { success: true, message: "Call ending." };
        this.sendToOpenAI({
            type: 'conversation.item.create',
            item: {
                type: 'function_call_output',
                call_id: callId,
                output: JSON.stringify(result)
            }
        });

        this.sendToOpenAI({
            type: 'response.create',
            response: {
                 instructions: "Say a short, polite goodbye right now."
            }
        });

        setTimeout(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.close();
            }
            if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
                this.openaiWs.close();
            }
        }, 10000);
        return; // Early return because we handled the output above manually
      }

      // Send result back to OpenAI for normal tools
      const functionOutput = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify(result)
        }
      };
      this.sendToOpenAI(functionOutput);

      if (name !== 'end_call') {
          this.sendToOpenAI({ type: 'response.create' });
      }

    } catch (error) {
      logger.error(`Error executing function ${name}:`, error);
      this.sendToOpenAI({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify({ error: error.message })
        }
      });
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
      this.callSid = data.start.callSid; // explicitly update callSid here
      this.isTwilioStarted = true;
      logger.info(`Stream started: ${this.streamSid}`);
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
