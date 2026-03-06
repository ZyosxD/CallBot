import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import twilio from 'twilio';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sendReport } from './emailService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class OpenAIRealtimeService {
  constructor(ws, callSid, callerId, mode) {
    this.ws = ws;
    this.callSid = callSid;
    this.callerId = callerId;
    this.mode = mode;
    this.openaiWs = null;
    this.streamSid = null;
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
        this.sendSessionUpdate();

        // Start the conversation immediately
        setTimeout(() => {
          this.sendToOpenAI({
            type: 'response.create',
            response: {
              instructions: 'Start the conversation immediately with your greeting.'
            }
          });
        }, 500);
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
            description: "Schedule a technical assessment after getting the Trifecta (Contact Name, Company Name, Confirmed Phone, Exact Time).",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the person" },
                companyName: { type: "string", description: "Name of the company" },
                confirmedPhone: { type: "string", description: "The confirmed phone number" },
                appointmentTime: { type: "string", description: "The exact time for the appointment" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report the interaction if the client is not interested, asks to call back later, or you reach a voicemail.",
            parameters: {
              type: "object",
              properties: {
                outcome: { type: "string", description: "The outcome of the call (e.g., 'Not interested', 'Call back later', 'Voicemail')" },
                details: { type: "string", description: "Additional details about the interaction" }
              },
              required: ["outcome", "details"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call gracefully after the conversation is finished and you have said goodbye.",
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
    const parsedArgs = JSON.parse(args);
    const callId = event.call_id;

    logger.info(`Function call detected: ${name} with args: ${args}`);
    let result = { status: "success" };

    try {
      if (name === 'schedule_appointment') {
        // Log to leads.json
        const leadsFile = path.join(__dirname, '../data/leads.json');
        let leads = [];
        if (fs.existsSync(leadsFile)) {
            leads = JSON.parse(fs.readFileSync(leadsFile, 'utf8'));
        }
        leads.push({ ...parsedArgs, timestamp: new Date().toISOString() });
        fs.writeFileSync(leadsFile, JSON.stringify(leads, null, 2));

        // Send Email
        await sendReport(true, this.callerId, parsedArgs.confirmedPhone, parsedArgs);

        result = { status: "Appointment scheduled successfully." };
      } else if (name === 'report_interaction') {
        // Log to interactions.json
        const interactionsFile = path.join(__dirname, '../data/interactions.json');
        let interactions = [];
        if (fs.existsSync(interactionsFile)) {
            interactions = JSON.parse(fs.readFileSync(interactionsFile, 'utf8'));
        }
        interactions.push({ callerId: this.callerId, ...parsedArgs, timestamp: new Date().toISOString() });
        fs.writeFileSync(interactionsFile, JSON.stringify(interactions, null, 2));

        // Send Email
        await sendReport(false, this.callerId, 'N/A', parsedArgs);

        result = { status: "Interaction reported." };
      } else if (name === 'end_call') {
          // Tell AI to finish its sentence/goodbye, then we will hang up in 10s
          result = { status: "Closing connection in 10 seconds." };
          setTimeout(() => {
              if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                  this.ws.close();
              }
              if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
                  this.openaiWs.close();
              }
          }, 10000);
      }

      // Send result back to OpenAI
      const functionOutput = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify(result)
        }
      };
      this.sendToOpenAI(functionOutput);

      // Trigger a response generation
      this.sendToOpenAI({ type: 'response.create' });

    } catch (error) {
      logger.error(`Error executing function ${name}:`, error);
      // Optionally send error back
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
      this.callSid = data.start.callSid; // Explicitly update from stream
      logger.info(`Stream started: ${this.streamSid} for call ${this.callSid}`);
    } else if (data.event === 'media') {
        const audioAppend = {
            type: 'input_audio_buffer.append',
            audio: data.media.payload
        };
        this.sendToOpenAI(audioAppend);
    }
  }
}
