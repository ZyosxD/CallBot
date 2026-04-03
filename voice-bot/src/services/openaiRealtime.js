import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendReportEmail } from './emailService.js';

export class OpenAIRealtimeService {
  constructor(ws, callSid, callerId = 'unknown', mode = 'inbound') {
    this.ws = ws;
    this.callSid = callSid;
    this.callerId = callerId;
    this.mode = mode;
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

      // Trigger greeting
      this.sendToOpenAI({
        type: 'response.create',
        response: {
          instructions: "Start the conversation immediately by greeting the caller. Speak only English."
        }
      });
    }
  }

  sendSessionUpdate() {
    const instructions = this.mode === 'outbound' ? prompts.SARAH_OUTBOUND : prompts.SARAH_INBOUND;

    const sessionUpdate = {
      type: 'session.update',
      session: {
        turn_detection: {
          type: 'server_vad',
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
            description: "Schedule a technical assessment after the customer agrees. Requires contactName, companyName, confirmedPhone, and appointmentTime.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string" },
                companyName: { type: "string" },
                confirmedPhone: { type: "string" },
                appointmentTime: { type: "string" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report if the user is not interested, asks to call later, or if it is a voicemail.",
            parameters: {
              type: "object",
              properties: {
                notes: { type: "string", description: "Reason for reporting (e.g., Not interested, call later, voicemail)" }
              },
              required: ["notes"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call conversation.",
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

    logger.info(`Function call detected: ${name} with args: ${args}`);

    let parsedArgs;
    try {
      parsedArgs = JSON.parse(args);
    } catch (e) {
      logger.error(`Failed to parse args for ${name}`, e);
      parsedArgs = {};
    }

    let result = null;

    try {
      if (name === 'schedule_appointment') {
        const leadData = {
          callerId: this.callerId,
          contactName: parsedArgs.contactName,
          companyName: parsedArgs.companyName,
          confirmedPhone: parsedArgs.confirmedPhone,
          appointmentTime: parsedArgs.appointmentTime,
          timestamp: new Date().toISOString()
        };

        const leadsPath = path.resolve('src/data/leads.json');
        const leads = JSON.parse(fs.readFileSync(leadsPath, 'utf8') || '[]');
        leads.push(leadData);
        fs.writeFileSync(leadsPath, JSON.stringify(leads, null, 2));

        sendReportEmail('SUCCESS', leadData);
        result = { status: 'appointment_scheduled' };
      } else if (name === 'report_interaction') {
        const interactionData = {
          callerId: this.callerId,
          notes: parsedArgs.notes,
          timestamp: new Date().toISOString()
        };

        const interactionsPath = path.resolve('src/data/interactions.json');
        const interactions = JSON.parse(fs.readFileSync(interactionsPath, 'utf8') || '[]');
        interactions.push(interactionData);
        fs.writeFileSync(interactionsPath, JSON.stringify(interactions, null, 2));

        sendReportEmail('REPORT', interactionData);
        result = { status: 'interaction_reported' };
      } else if (name === 'end_call') {
        result = { status: 'ending_call' };

        // Instruct OpenAI to say goodbye
        this.sendToOpenAI({
          type: 'response.create',
          response: {
            instructions: "Say a short, polite goodbye."
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
      }

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
      this.callSid = data.start.callSid;
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
