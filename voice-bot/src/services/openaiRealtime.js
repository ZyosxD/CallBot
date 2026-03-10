import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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
    const prompt = this.mode === 'outbound' ? prompts.SARAH_OUTBOUND : prompts.SARAH_INBOUND;

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
        instructions: prompt,
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Schedule a Technical Assessment. Requires collecting Contact Name, Company Name, Confirmed Phone, and exact Appointment Time.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Contact Name (IT Manager/Owner)" },
                companyName: { type: "string", description: "Company Name" },
                confirmedPhone: { type: "string", description: "Verbally Confirmed Phone number" },
                appointmentTime: { type: "string", description: "Exact Appointment Time" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Log an interaction if the lead is not interested, asks to call back later, or it goes to voicemail.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Outcome reason (e.g., 'not interested', 'call back later', 'voicemail')" },
                notes: { type: "string", description: "Additional notes" }
              },
              required: ["reason"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the conversation politely.",
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

        // Force the AI to speak first
        let initialGreeting = "Hi, this is Sarah with 1Wire.";
        if (this.mode === 'outbound') {
             initialGreeting = "Hi, this is Sarah with 1Wire. Do you handle the technology, or should I ask for an Office Manager?";
        }

        this.sendToOpenAI({
            type: 'response.create',
            response: {
                 instructions: `Start the conversation immediately by saying: "${initialGreeting}"`
            }
        });
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
    let result = null;

    try {
      if (name === 'schedule_appointment') {
        // save to leads.json
        const leadsPath = path.join(__dirname, '../data/leads.json');
        const leads = JSON.parse(fs.readFileSync(leadsPath, 'utf8'));

        const newLead = {
             contactName: parsedArgs.contactName,
             companyName: parsedArgs.companyName,
             confirmedPhone: parsedArgs.confirmedPhone,
             appointmentTime: parsedArgs.appointmentTime,
             callerId: this.callerId,
             timestamp: new Date().toISOString()
        };
        leads.push(newLead);
        fs.writeFileSync(leadsPath, JSON.stringify(leads, null, 2));

        await sendSuccessEmail(parsedArgs.contactName, parsedArgs.companyName, this.callerId, parsedArgs.confirmedPhone, parsedArgs.appointmentTime);
        result = { status: 'success' };
      } else if (name === 'report_interaction') {
        // save to interactions.json
        const interactionsPath = path.join(__dirname, '../data/interactions.json');
        const interactions = JSON.parse(fs.readFileSync(interactionsPath, 'utf8'));

        const newInteraction = {
             callerId: this.callerId,
             reason: parsedArgs.reason,
             notes: parsedArgs.notes,
             timestamp: new Date().toISOString()
        };
        interactions.push(newInteraction);
        fs.writeFileSync(interactionsPath, JSON.stringify(interactions, null, 2));

        await sendReportEmail(this.callerId, parsedArgs.reason, parsedArgs.notes);
        result = { status: 'success' };
      } else if (name === 'end_call') {
        logger.info(`Ending call for ${this.callSid} in 10 seconds...`);
        setTimeout(() => {
             if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                 this.ws.close();
             }
             if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
                 this.openaiWs.close();
             }
        }, 10000);
        result = { status: 'ending' };
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
      this.callSid = data.start.callSid; // correctly track the session ID

      if (data.start.customParameters) {
          if (data.start.customParameters.callerId) {
             this.callerId = data.start.customParameters.callerId;
          }
          if (data.start.customParameters.mode) {
             this.mode = data.start.customParameters.mode;
          }
      }

      logger.info(`Stream started: ${this.streamSid} | callSid: ${this.callSid} | callerId: ${this.callerId} | mode: ${this.mode}`);
    } else if (data.event === 'media') {
        const audioAppend = {
            type: 'input_audio_buffer.append',
            audio: data.media.payload
        };
        this.sendToOpenAI(audioAppend);
    }
  }
}
