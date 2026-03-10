import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import WebSocket from 'ws';
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
        this.startConversation();
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

  startConversation() {
    const greeting = this.mode === 'outbound' ? 'Start the conversation immediately with the outbound script.' : 'Start the conversation immediately with the inbound script.';
    const createResponse = {
      type: 'response.create',
      response: {
        instructions: greeting
      }
    };
    this.sendToOpenAI(createResponse);
  }

  sendSessionUpdate() {
    const systemPrompt = this.mode === 'outbound' ? prompts.SARAH_OUTBOUND : prompts.SARAH_INBOUND;

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
        instructions: systemPrompt,
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Schedule a Technical Assessment after collecting The Trifecta.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Who we should ask for" },
                companyName: { type: "string", description: "Name of the company" },
                confirmedPhone: { type: "string", description: "The best phone number to reach them at" },
                appointmentTime: { type: "string", description: "The exact date/time they agreed to" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report the outcome of the interaction when no appointment was scheduled (e.g., voicemail, not interested, call later).",
            parameters: {
              type: "object",
              properties: {
                outcome: { type: "string", description: "The outcome of the call (e.g., 'not interested', 'voicemail', 'call back later')" },
                notes: { type: "string", description: "Any additional notes from the conversation" }
              },
              required: ["outcome", "notes"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "Gracefully end the conversation and disconnect the call.",
            parameters: {
              type: "object",
              properties: {
                farewellMessage: { type: "string", description: "The final message to say to the user before hanging up." }
              },
              required: ["farewellMessage"]
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
        const lead = {
          ...parsedArgs,
          timestamp: new Date().toISOString()
        };
        const leads = JSON.parse(fs.readFileSync(leadsFilePath, 'utf8'));
        leads.push(lead);
        fs.writeFileSync(leadsFilePath, JSON.stringify(leads, null, 2));

        await sendSuccessEmail(lead, this.callerId);
        result = { success: true, message: 'Appointment scheduled successfully.' };
      } else if (name === 'report_interaction') {
        const interaction = {
          ...parsedArgs,
          timestamp: new Date().toISOString()
        };
        const interactions = JSON.parse(fs.readFileSync(interactionsFilePath, 'utf8'));
        interactions.push(interaction);
        fs.writeFileSync(interactionsFilePath, JSON.stringify(interactions, null, 2));

        await sendReportEmail(interaction, this.callerId);
        result = { success: true, message: 'Interaction reported successfully.' };
      } else if (name === 'end_call') {
        result = { success: true, message: 'Ending call.' };

        // Let OpenAI finish speaking the farewell message, then close socket
        setTimeout(() => {
          logger.info(`Ending call ${this.callSid} gracefully after delay.`);
          if (this.ws && this.ws.readyState === 1) { // 1 = OPEN
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
    }
  }

  sendAudioToTwilio(audioPayload) {
    if (this.ws && this.ws.readyState === 1 && this.streamSid) { // 1 = OPEN
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

      // Extract custom parameters
      if (data.start.customParameters) {
        this.callerId = data.start.customParameters.callerId || this.callerId;
        this.mode = data.start.customParameters.mode || this.mode;
      }
      logger.info(`Stream started: ${this.streamSid} for CallSid: ${this.callSid} (CallerID: ${this.callerId}, Mode: ${this.mode})`);
    } else if (data.event === 'media') {
        const audioAppend = {
            type: 'input_audio_buffer.append',
            audio: data.media.payload
        };
        this.sendToOpenAI(audioAppend);
    }
  }
}
