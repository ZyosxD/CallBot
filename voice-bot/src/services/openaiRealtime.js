import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendReportEmail } from './emailService.js';
import dayjs from 'dayjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LEADS_FILE = path.join(__dirname, '../data/leads.json');
const INTERACTIONS_FILE = path.join(__dirname, '../data/interactions.json');

export class OpenAIRealtimeService {
  constructor(ws, callSid) {
    this.ws = ws;
    this.callSid = callSid;
    this.openaiWs = null;
    this.streamSid = null;
    this.callerId = 'Unknown';
    this.mode = 'inbound';
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
    const isOutbound = this.mode === 'outbound';
    const instructions = isOutbound ? prompts.SARAH_OUTBOUND : prompts.SARAH_INBOUND;

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
            description: "Schedule a technical assessment once The Trifecta (Contact Name, Company Name, Verified Phone) and the Appointment Time are collected.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "The person handling technology" },
                companyName: { type: "string", description: "The company name" },
                confirmedPhone: { type: "string", description: "The verbally confirmed phone number" },
                appointmentTime: { type: "string", description: "The agreed upon time for the assessment tomorrow" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Log an interaction where the client was not interested, asked to call back, or it was a voicemail.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string" },
                companyName: { type: "string" },
                confirmedPhone: { type: "string" },
                notes: { type: "string", description: "Details on why they weren't interested or other info." }
              },
              required: ["notes"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call and disconnect.",
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
    let result = null;

    try {
      if (name === 'schedule_appointment') {
        result = await this.executeScheduleAppointment(parsedArgs);
      } else if (name === 'report_interaction') {
        result = await this.executeReportInteraction(parsedArgs);
      } else if (name === 'end_call') {
        await this.executeEndCall();
        result = { status: 'ending_call' };
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

      if (name !== 'end_call') {
          // Trigger a response generation
          this.sendToOpenAI({ type: 'response.create' });
      }

    } catch (error) {
      logger.error(`Error executing function ${name}:`, error);
    }
  }

  async executeScheduleAppointment(data) {
      const payload = {
          id: Date.now(),
          timestamp: dayjs().format(),
          callerId: this.callerId,
          ...data
      };

      try {
          const leads = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8'));
          leads.push(payload);
          fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));

          // Send Email
          await sendReportEmail('SUCCESS', payload);

          return { success: true, message: 'Appointment Scheduled' };
      } catch (e) {
          logger.error('Error saving lead:', e);
          return { success: false, error: 'Database error' };
      }
  }

  async executeReportInteraction(data) {
      const payload = {
          id: Date.now(),
          timestamp: dayjs().format(),
          callerId: this.callerId,
          ...data
      };

      try {
          const interactions = JSON.parse(fs.readFileSync(INTERACTIONS_FILE, 'utf8'));
          interactions.push(payload);
          fs.writeFileSync(INTERACTIONS_FILE, JSON.stringify(interactions, null, 2));

          // Send Email
          await sendReportEmail('REPORT', payload);

          return { success: true, message: 'Interaction logged' };
      } catch (e) {
          logger.error('Error saving interaction:', e);
          return { success: false, error: 'Database error' };
      }
  }

  async executeEndCall() {
      logger.info(`Ending call ${this.callSid} in 10 seconds... Sending farewell.`);

      // Send a final message to prompt the AI to say goodbye
      this.sendToOpenAI({
          type: 'response.create',
          response: {
              instructions: "The call is ending. Say a short, polite goodbye."
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
      this.callSid = data.start.callSid; // Update CallSid explicitly

      // Extract custom parameters
      if (data.start.customParameters) {
          this.callerId = data.start.customParameters.callerId || this.callerId;
          this.mode = data.start.customParameters.mode || this.mode;
      }

      logger.info(`Stream started: ${this.streamSid} | Mode: ${this.mode} | CallerID: ${this.callerId}`);

      // Send initial greeting instructions to OpenAI
      const greeting = this.mode === 'outbound' ? prompts.greetingOutbound : prompts.greetingInbound;
      this.sendToOpenAI({
          type: 'response.create',
          response: {
              instructions: `Start the conversation immediately. Say exactly: "${greeting}"`
          }
      });

    } else if (data.event === 'media') {
        const audioAppend = {
            type: 'input_audio_buffer.append',
            audio: data.media.payload
        };
        this.sendToOpenAI(audioAppend);
    }
  }
}
