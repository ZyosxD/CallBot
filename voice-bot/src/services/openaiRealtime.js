import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendEmail } from './emailService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LEADS_FILE = path.join(__dirname, '../data/leads.json');
const INTERACTIONS_FILE = path.join(__dirname, '../data/interactions.json');

export class OpenAIRealtimeService {
  constructor(ws, callSid, clientData = {}) {
    this.ws = ws;
    this.callSid = callSid;
    this.clientData = clientData; // Store client data (callerId, etc.)
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
    const sessionUpdate = {
      type: 'session.update',
      session: {
        turn_detection: {
          type: 'server_vad',
          silence_duration_ms: 1500, // 1500ms VAD
        },
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        voice: 'coral', // Sarah's voice
        instructions: prompts.systemInstruction,
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Schedule a Technical Assessment after collecting The Trifecta (Name, Company, Phone) and Time.",
            parameters: {
              type: "object",
              properties: {
                name: { type: "string", description: "Contact Name" },
                companyName: { type: "string", description: "Company Name" },
                phone: { type: "string", description: "Verified Phone Number" },
                phoneVerified: { type: "boolean", description: "True if user confirmed this is the best number" },
                dateTime: { type: "string", description: "Date and Time for the assessment" },
                notes: { type: "string", description: "Any additional notes" }
              },
              required: ["name", "companyName", "phone", "dateTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report an interaction that did not result in an immediate appointment (e.g. not interested, call later, voicemail).",
            parameters: {
              type: "object",
              properties: {
                outcome: { type: "string", description: "Result: Not Interested, Call Later, Voicemail, Gatekeeper Blocked, etc." },
                notes: { type: "string", description: "Details about the conversation" }
              },
              required: ["outcome"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call politely.",
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

    // Use clientData.callerId if available, fallback to callSid
    const callerId = this.clientData.callerId || this.callSid;

    try {
      if (name === 'schedule_appointment') {
        // Save to leads.json
        let leads = [];
        try {
            leads = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8') || '[]');
        } catch (e) { leads = []; }

        const lead = { ...parsedArgs, callSid: this.callSid, timestamp: new Date().toISOString() };
        leads.push(lead);
        fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));

        // Send Email
        await sendEmail('APPOINTMENT', { ...parsedArgs, callerId: callerId });

        result = { status: 'scheduled' };
      } else if (name === 'report_interaction') {
        // Save to interactions.json
        let interactions = [];
        try {
            interactions = JSON.parse(fs.readFileSync(INTERACTIONS_FILE, 'utf8') || '[]');
        } catch (e) { interactions = []; }

        const interaction = { ...parsedArgs, callSid: this.callSid, timestamp: new Date().toISOString() };
        interactions.push(interaction);
        fs.writeFileSync(INTERACTIONS_FILE, JSON.stringify(interactions, null, 2));

        // Send Email
        await sendEmail('REPORT', { ...parsedArgs, callerId: callerId });

        result = { status: 'reported' };
      } else if (name === 'end_call') {
        // Handle end call logic
        logger.info('Tool end_call invoked. Closing in 10s.');

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
      // Extract callerId from start event if available (req.body.From is not here, it's in initial request)
      // But we can check customParameters
      if (data.start.customParameters && data.start.customParameters.callerId) {
          this.clientData.callerId = data.start.customParameters.callerId;
      }
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
