import WebSocket from 'ws';
import { config } from '../config/config.js';
import { SARAH_OUTBOUND, SARAH_INBOUND } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import twilio from 'twilio';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LEADS_FILE = path.join(__dirname, '../data/leads.json');
const INTERACTIONS_FILE = path.join(__dirname, '../data/interactions.json');

export class OpenAIRealtimeService {
  constructor(ws, callSid, callerId, mode) {
    this.ws = ws;
    this.callSid = callSid;
    this.callerId = callerId;
    this.mode = mode;
    this.openaiWs = null;
    this.streamSid = null;

    // Select persona based on mode
    this.systemInstruction = this.mode === 'outbound' ? SARAH_OUTBOUND : SARAH_INBOUND;
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
          silence_duration_ms: 1500
        },
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        voice: 'coral',
        instructions: this.systemInstruction,
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Schedule an appointment (The Trifecta) when a client agrees.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Who should we ask for?" },
                companyName: { type: "string", description: "Name of the company" },
                confirmedPhone: { type: "string", description: "The best phone number to reach them at" },
                appointmentTime: { type: "string", description: "Exact time for tomorrow" },
                notes: { type: "string", description: "Any extra notes" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report an interaction if the client is not interested, asks to call back later, or if it's a voicemail.",
            parameters: {
              type: "object",
              properties: {
                outcome: { type: "string", description: "Result of the call (e.g., Not interested, Call back, Voicemail)" },
                companyName: { type: "string", description: "Name of the company if known" },
                contactName: { type: "string", description: "Name of the contact if known" },
                notes: { type: "string", description: "Any extra notes" }
              },
              required: ["outcome"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call when the conversation is over.",
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

        // Start conversation for outbound
        if (this.mode === 'outbound') {
          this.sendToOpenAI({
            type: 'response.create',
            response: {
              instructions: "Start the conversation immediately. Introduce yourself as Sarah from 1Wire and ask for the technology manager or office manager."
            }
          });
        }
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
        // Read, append, write leads
        const fileContent = await fs.readFile(LEADS_FILE, 'utf-8');
        const leads = JSON.parse(fileContent || '[]');
        leads.push({ ...parsedArgs, originalCallerId: this.callerId, timestamp: new Date().toISOString() });
        await fs.writeFile(LEADS_FILE, JSON.stringify(leads, null, 2));

        // Send email
        await sendSuccessEmail(parsedArgs, this.callerId, parsedArgs.confirmedPhone);

        result = { status: 'appointment_scheduled' };
      } else if (name === 'report_interaction') {
        // Read, append, write interactions
        const fileContent = await fs.readFile(INTERACTIONS_FILE, 'utf-8');
        const interactions = JSON.parse(fileContent || '[]');
        interactions.push({ ...parsedArgs, callerId: this.callerId, timestamp: new Date().toISOString() });
        await fs.writeFile(INTERACTIONS_FILE, JSON.stringify(interactions, null, 2));

        // Send email
        await sendReportEmail(parsedArgs, this.callerId);

        result = { status: 'interaction_reported' };
      } else if (name === 'end_call') {
        result = { status: 'ending_call' };

        // Disconnect logic with 10s delay
        setTimeout(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.close();
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
      this.callSid = data.start.callSid; // update callSid here

      const customParams = data.start.customParameters || {};
      this.callerId = customParams.callerId || this.callerId;
      this.mode = customParams.mode || this.mode;

      logger.info(`Stream started: ${this.streamSid} | CallSid: ${this.callSid} | CallerId: ${this.callerId} | Mode: ${this.mode}`);
    } else if (data.event === 'media') {
        const audioAppend = {
            type: 'input_audio_buffer.append',
            audio: data.media.payload
        };
        this.sendToOpenAI(audioAppend);
    }
  }
}
