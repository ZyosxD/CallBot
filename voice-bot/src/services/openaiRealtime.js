import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const leadsFilePath = path.join(__dirname, '../data/leads.json');
const interactionsFilePath = path.join(__dirname, '../data/interactions.json');

export class OpenAIRealtimeService {
  constructor(ws, callSid, callerId, mode) {
    this.ws = ws;
    this.callSid = callSid;
    this.callerId = callerId;
    this.mode = mode; // 'inbound' or 'outbound'
    this.openaiWs = null;
    this.streamSid = null;

    this.isOpenAiConnected = false;
    this.isTwilioStarted = false;
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
    if (this.isOpenAiConnected && this.isTwilioStarted && !this.sessionInitialized) {
      this.sessionInitialized = true;
      this.sendSessionUpdate();

      // Kick off the conversation immediately
      this.sendToOpenAI({
        type: 'response.create',
        response: {
          instructions: 'Start the conversation immediately by greeting the user following your conversational flow rules.',
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
            description: "Schedules a Technical Assessment after collecting all required details.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "The person's name" },
                companyName: { type: "string", description: "The company's name" },
                confirmedPhone: { type: "string", description: "The phone number they confirmed to call them back at" },
                appointmentTime: { type: "string", description: "The specific time tomorrow for the assessment" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Logs the interaction if the client is not interested, asks to call back later, or if you reach a voicemail.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "The outcome of the call (e.g., 'Not interested', 'Voicemail', 'Call back later')" }
              },
              required: ["reason"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "Ends the conversation politely.",
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
    let result = null;
    let parsedArgs;

    try {
      parsedArgs = JSON.parse(args);
    } catch (e) {
      logger.error(`Failed to parse arguments for ${name}: ${args}`, e);
      result = { error: "Invalid JSON arguments provided." };
      return this.sendFunctionResult(callId, result);
    }

    try {
      if (name === 'schedule_appointment') {
        const { contactName, companyName, confirmedPhone, appointmentTime } = parsedArgs;

        // Save to leads.json
        const leads = fs.existsSync(leadsFilePath) ? JSON.parse(fs.readFileSync(leadsFilePath)) : [];
        leads.push({
          contactName, companyName, confirmedPhone, appointmentTime, originalCallerId: this.callerId, timestamp: new Date().toISOString()
        });
        fs.writeFileSync(leadsFilePath, JSON.stringify(leads, null, 2));

        // Send Email
        await sendSuccessEmail(contactName, companyName, confirmedPhone, appointmentTime, this.callerId);

        result = { status: 'success', message: 'Technical assessment scheduled.' };

      } else if (name === 'report_interaction') {
        const { reason } = parsedArgs;

        // Save to interactions.json
        const interactions = fs.existsSync(interactionsFilePath) ? JSON.parse(fs.readFileSync(interactionsFilePath)) : [];
        interactions.push({
          reason, originalCallerId: this.callerId, timestamp: new Date().toISOString()
        });
        fs.writeFileSync(interactionsFilePath, JSON.stringify(interactions, null, 2));

        // Send Email
        await sendReportEmail(reason, this.callerId);

        result = { status: 'logged', message: 'Interaction recorded.' };

      } else if (name === 'end_call') {
        result = { status: 'closing' };

        // Send result immediately to avoid hang
        this.sendFunctionResult(callId, result);

        // Instruct AI to say goodbye
        this.sendToOpenAI({
          type: 'response.create',
          response: {
            instructions: 'Say a short, polite goodbye and wait for them to hang up.',
          }
        });

        // Close after 10s delay
        setTimeout(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.close();
          }
          if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
            this.openaiWs.close();
          }
        }, 10000);
        return; // Early return since we handled the response
      }

      this.sendFunctionResult(callId, result);

      if (name !== 'end_call') {
        // Trigger a response generation after a standard tool call
        this.sendToOpenAI({ type: 'response.create' });
      }

    } catch (error) {
      logger.error(`Error executing function ${name}:`, error);
      this.sendFunctionResult(callId, { error: error.message });
    }
  }

  sendFunctionResult(callId, result) {
    const functionOutput = {
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: JSON.stringify(result)
      }
    };
    this.sendToOpenAI(functionOutput);
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
      this.callSid = data.start.callSid; // explicitly updating from Twilio start event
      this.isTwilioStarted = true;
      logger.info(`Stream started: ${this.streamSid} for CallSid: ${this.callSid}`);
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
