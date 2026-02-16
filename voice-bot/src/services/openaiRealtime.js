import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';
import { notifyCallEnded } from '../services/dripService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LEADS_FILE = path.join(__dirname, '../data/leads.json');
const INTERACTIONS_FILE = path.join(__dirname, '../data/interactions.json');
const CLIENTS_FILE = path.join(__dirname, '../data/clients.json');

export class OpenAIRealtimeService {
  constructor(ws, callSid, options = {}) {
    this.ws = ws;
    this.callSid = callSid;
    this.callType = options.callType || 'inbound';
    this.clientId = options.clientId || null;
    this.openaiWs = null;
    this.streamSid = null;
    this.clientData = this.loadClientData();
  }

  loadClientData() {
    if (!this.clientId) return { name: 'Unknown Caller', phone: 'Unknown' };
    try {
      const data = fs.readFileSync(CLIENTS_FILE, 'utf8');
      const clients = JSON.parse(data);
      // Loose equality to match string/number
      return clients.find(c => c.id == this.clientId) || { name: 'Unknown Caller', phone: 'Unknown' };
    } catch (error) {
      logger.error('Error loading client data:', error);
      return { name: 'Unknown Caller', phone: 'Unknown' };
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
    const instruction = prompts.systemInstruction[this.callType] || prompts.systemInstruction.inbound;

    const sessionUpdate = {
      type: 'session.update',
      session: {
        turn_detection: { type: 'server_vad', silence_duration_ms: 1500 },
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        voice: 'coral',
        instructions: instruction,
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Schedule a technical assessment when all data (Trifecta + Time) is collected.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string" },
                companyName: { type: "string" },
                phone: { type: "string" },
                date: { type: "string", description: "YYYY-MM-DD" },
                time: { type: "string", description: "HH:mm" },
                notes: { type: "string" }
              },
              required: ["contactName", "companyName", "phone", "date", "time"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report the interaction outcome (not interested, voicemail, call later, etc.)",
            parameters: {
              type: "object",
              properties: {
                outcome: { type: "string", enum: ["Not Interested", "Voicemail", "Call Later", "Other"] },
                notes: { type: "string" }
              },
              required: ["outcome"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call politely. Say goodbye before calling this.",
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

    logger.info(`Function call detected: ${name}`);
    let result = { status: 'success' };

    try {
      if (name === 'schedule_appointment') {
        this.saveLead(parsedArgs);
        // Combine client data from file with args from conversation
        const combinedData = { ...this.clientData, ...parsedArgs };
        // If phone was collected in conversation, prefer it
        if (parsedArgs.phone) combinedData.phone = parsedArgs.phone;

        await sendSuccessEmail(combinedData, parsedArgs);
        result = { message: 'Appointment scheduled and email sent.' };
      } else if (name === 'report_interaction') {
        this.saveInteraction(parsedArgs);
        await sendReportEmail(this.clientData, parsedArgs);
        result = { message: 'Interaction reported.' };
      } else if (name === 'end_call') {
        logger.info('End call requested by AI. Closing in 10s...');
        // Wait 10s then close
        setTimeout(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.close();
            }
            if (this.callType === 'outbound') {
                notifyCallEnded();
            }
        }, 10000);
        result = { message: 'Ending call in 10 seconds.' };
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

  saveLead(data) {
    try {
        const fileContent = fs.readFileSync(LEADS_FILE, 'utf8');
        const leads = JSON.parse(fileContent);
        leads.push({ ...data, timestamp: new Date().toISOString(), callSid: this.callSid });
        fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
    } catch (error) {
        logger.error('Error saving lead:', error);
    }
  }

  saveInteraction(data) {
    try {
        const fileContent = fs.readFileSync(INTERACTIONS_FILE, 'utf8');
        const interactions = JSON.parse(fileContent);
        interactions.push({ ...data, timestamp: new Date().toISOString(), callSid: this.callSid, clientData: this.clientData });
        fs.writeFileSync(INTERACTIONS_FILE, JSON.stringify(interactions, null, 2));
    } catch (error) {
        logger.error('Error saving interaction:', error);
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
