import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';
import { loadClients } from './dripService.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class OpenAIRealtimeService {
  constructor(ws, callSid, options = {}) {
    this.ws = ws;
    this.callSid = callSid;
    this.context = options.context || 'inbound';
    this.clientId = options.clientId;
    this.callerId = options.callerId;
    this.openaiWs = null;
    this.streamSid = null;
    this.clientData = null;

    if (this.clientId) {
      const clients = loadClients();
      this.clientData = clients.find(c => c.id == this.clientId);
    }
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

        // If outbound, trigger the initial greeting
        if (this.context === 'outbound' && this.clientData) {
             setTimeout(() => {
                 this.sendToOpenAI({ type: 'response.create' });
             }, 500);
        }
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
        instructions: prompts.systemInstruction + (this.context === 'outbound' ? `\n\nContext: Outbound call to ${this.clientData?.company || 'a company'}. Start conversation immediately.` : `\n\nContext: Inbound call.`),
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Schedule a technical assessment after collecting The Trifecta and Time.",
            parameters: {
              type: "object",
              properties: {
                name: { type: "string", description: "Contact Name" },
                company: { type: "string", description: "Company Name" },
                phone: { type: "string", description: "Verified Phone Number" },
                date: { type: "string", description: "Date (e.g., tomorrow)" },
                time: { type: "string", description: "Time (e.g., 2:00 PM)" }
              },
              required: ["name", "company", "phone", "date", "time"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report call outcome when not interested or voicemail.",
            parameters: {
              type: "object",
              properties: {
                status: { type: "string", enum: ["not_interested", "call_later", "voicemail", "other"] },
                reason: { type: "string", description: "Details about the outcome" }
              },
              required: ["status", "reason"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call with a polite goodbye.",
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
    let result = { success: true };

    try {
      if (name === 'schedule_appointment') {
        // Save to leads.json
        const leadsFile = path.join(__dirname, '../data/leads.json');
        const leads = JSON.parse(fs.readFileSync(leadsFile, 'utf8'));
        leads.push({ ...parsedArgs, timestamp: new Date().toISOString() });
        fs.writeFileSync(leadsFile, JSON.stringify(leads, null, 2));

        // Send Email
        const originalPhone = this.clientData?.phone || this.callerId;
        await sendSuccessEmail(parsedArgs, originalPhone);

        result = { message: "Appointment scheduled and email sent." };
      } else if (name === 'report_interaction') {
        // Save to interactions.json
        const interactionsFile = path.join(__dirname, '../data/interactions.json');
        const interactions = JSON.parse(fs.readFileSync(interactionsFile, 'utf8'));
        interactions.push({ ...parsedArgs, phone: this.clientData?.phone || this.callerId, timestamp: new Date().toISOString() });
        fs.writeFileSync(interactionsFile, JSON.stringify(interactions, null, 2));

        // Send Email
        await sendReportEmail({ ...parsedArgs, phone: this.clientData?.phone || this.callerId });

        result = { message: "Interaction reported." };
      } else if (name === 'end_call') {
        logger.info('Ending call as requested by AI.');
        setTimeout(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.close();
            }
            if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
                this.openaiWs.close();
            }
        }, 10000); // 10s delay
        result = { message: "Call ending in 10 seconds." };
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
      logger.info(`Stream started: ${this.streamSid}`);
    } else if (data.event === 'media') {
        const audioAppend = {
            type: 'input_audio_buffer.append',
            audio: data.media.payload
        };
        this.sendToOpenAI(audioAppend);
    }
  }
}
