import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';
import { markCallEnded } from './dripService.js';

const leadsPath = path.join(process.cwd(), 'src/data/leads.json');
const interactionsPath = path.join(process.cwd(), 'src/data/interactions.json');

const readJson = (file) => {
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf8'));
};

const writeJson = (file, data) => {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
};

export class OpenAIRealtimeService {
  constructor(ws, callSid, callerId, mode) {
    this.ws = ws;
    this.callSid = callSid || 'unknown';
    this.callerId = callerId || 'unknown';
    this.mode = mode || 'inbound';
    this.openaiWs = null;
    this.streamSid = null;
    this.sessionInitialized = false;
  }

  async connect() {
    try {
      this.openaiWs = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01', {
        headers: {
          'Authorization': `Bearer ${config.openai.apiKey}`,
          'OpenAI-Beta': 'realtime=v1',
        },
      });

      return new Promise((resolve) => {
        this.openaiWs.on('open', () => {
          logger.info('Connected to OpenAI Realtime API');
          resolve();
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
      });
    } catch (error) {
      logger.error('Error connecting to OpenAI:', error);
    }
  }

  checkAndInitializeSession(isTwilioStarted, isOpenAiConnected) {
    if (isTwilioStarted && isOpenAiConnected && !this.sessionInitialized) {
      this.sendSessionUpdate();
      this.sessionInitialized = true;

      // If OUTBOUND, force the AI to speak first
      if (this.mode === 'outbound') {
        const greeting = "Hi, are you the person handling the technology there, or should I speak to the office manager?";
        this.sendToOpenAI({
          type: 'response.create',
          response: {
            instructions: `Start the conversation immediately by saying exactly this or similar: "${greeting}"`
          }
        });
      }
    }
  }

  sendSessionUpdate() {
    const instructions = this.mode === 'outbound' ? prompts.SARAH_OUTBOUND : prompts.SARAH_INBOUND;

    const sessionUpdate = {
      type: 'session.update',
      session: {
        turn_detection: { type: 'server_vad', silence_duration_ms: 1500 },
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
            description: "Schedule a Technical Assessment when the user agrees. You MUST collect contactName, companyName, confirmedPhone, and appointmentTime before calling this tool.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the person to contact (IT Manager/Owner)" },
                companyName: { type: "string", description: "Name of the company" },
                confirmedPhone: { type: "string", description: "The phone number the user verbally verified is best to call" },
                appointmentTime: { type: "string", description: "The exact time for the appointment" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Log the interaction if the user is not interested, went to voicemail, or asks to call later.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Reason for logging (e.g., 'Not interested', 'Voicemail', 'Call later')" },
                summary: { type: "string", description: "A brief summary of what happened" }
              },
              required: ["reason", "summary"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call gracefully at the very end of the conversation.",
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
          logConversation(this.callSid, 'Sarah', event.transcript);
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
    let parsedArgs = {};
    const callId = event.call_id;

    logger.info(`Function call detected: ${name} with args: ${args}`);

    try {
      parsedArgs = JSON.parse(args);
    } catch (e) {
      logger.error('Error parsing function arguments JSON:', e);
      // Return error to OpenAI
      const functionOutput = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify({ error: 'Invalid JSON arguments' })
        }
      };
      this.sendToOpenAI(functionOutput);
      return;
    }

    let result = { status: 'success' };

    try {
      if (name === 'schedule_appointment') {
        // Save to leads.json
        const leads = readJson(leadsPath);
        leads.push({ ...parsedArgs, originalPhone: this.callerId, timestamp: new Date().toISOString() });
        writeJson(leadsPath, leads);

        // Send email
        await sendSuccessEmail({
          originalPhone: this.callerId,
          confirmedPhone: parsedArgs.confirmedPhone,
          contactName: parsedArgs.contactName,
          companyName: parsedArgs.companyName,
          appointmentTime: parsedArgs.appointmentTime
        });
      } else if (name === 'report_interaction') {
        // Save to interactions.json
        const interactions = readJson(interactionsPath);
        interactions.push({ ...parsedArgs, originalPhone: this.callerId, timestamp: new Date().toISOString() });
        writeJson(interactionsPath, interactions);

        // Send email
        await sendReportEmail({
          originalPhone: this.callerId,
          reason: parsedArgs.reason,
          summary: parsedArgs.summary
        });
      } else if (name === 'end_call') {
        result = { status: 'ending call in 10 seconds' };

        // Let OpenAI speak a goodbye, then close
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
          markCallEnded(this.callSid); // Release lock
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

      if (name !== 'end_call') {
        // Trigger a response generation for normal tools
        this.sendToOpenAI({ type: 'response.create' });
      }

    } catch (error) {
      logger.error(`Error executing function ${name}:`, error);
      const functionOutput = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify({ error: error.message })
        }
      };
      this.sendToOpenAI(functionOutput);
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
      // Memory: explicitly update callSid from start event
      this.callSid = data.start.callSid;
      logger.info(`Stream started: ${this.streamSid} for CallSid: ${this.callSid}`);
    } else if (data.event === 'media') {
        const audioAppend = {
            type: 'input_audio_buffer.append',
            audio: data.media.payload
        };
        this.sendToOpenAI(audioAppend);
    }
  }
}
