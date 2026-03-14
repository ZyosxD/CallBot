import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendEmailReport } from './emailService.js';
import twilio from 'twilio';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const leadsFilePath = path.join(__dirname, '../data/leads.json');
const interactionsFilePath = path.join(__dirname, '../data/interactions.json');

const appendData = (filePath, data) => {
  try {
    let currentData = [];
    if (fs.existsSync(filePath)) {
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      currentData = JSON.parse(fileContent);
    }
    currentData.push(data);
    fs.writeFileSync(filePath, JSON.stringify(currentData, null, 2));
  } catch (err) {
    logger.error(`Error appending data to ${filePath}:`, err);
  }
};

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
        if (this.streamSid) {
          // If Twilio stream already started before OpenAI connected, initialize now.
          this.sendSessionUpdate();
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
    const prompt = this.mode === 'outbound' ? prompts.SARAH_OUTBOUND : prompts.SARAH_INBOUND;

    const sessionUpdate = {
      type: 'session.update',
      session: {
        turn_detection: { type: 'server_vad', silence_duration_ms: 1500 },
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
            description: "Schedule a Technical Assessment after receiving YES and collecting The Trifecta",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Who should we ask for? (IT Manager/Owner)" },
                companyName: { type: "string", description: "Name of the company" },
                confirmedPhone: { type: "string", description: "The confirmed phone number to call" },
                appointmentTime: { type: "string", description: "The exact time tomorrow for the appointment" },
                notes: { type: "string", description: "Any extra notes about their current setup or pain points" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report an interaction if the lead is not interested, wants to be called later, or it's a voicemail.",
            parameters: {
              type: "object",
              properties: {
                outcome: { type: "string", enum: ["not_interested", "call_later", "voicemail", "gatekeeper_rejected"] },
                notes: { type: "string", description: "Details about the interaction" }
              },
              required: ["outcome", "notes"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call gracefully. Always use this to hang up the call after saying goodbye.",
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

    // If outbound, trigger initial greeting
    if (this.mode === 'outbound') {
        const greeting = {
            type: "conversation.item.create",
            item: {
                type: "message",
                role: "system",
                content: [{
                    type: "input_text",
                    text: "Start the conversation immediately. Introduce yourself as Sarah from 1Wire and ask if they handle the technology or if you should ask for an Office Manager."
                }]
            }
        };
        this.sendToOpenAI(greeting);
        this.sendToOpenAI({ type: "response.create" });
    }
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
    const parsedArgs = JSON.parse(args);
    const callId = event.call_id;

    logger.info(`Function call detected: ${name} with args: ${args}`);
    let result = null;

    try {
      if (name === 'schedule_appointment') {
        const leadData = {
            id: Date.now(),
            ...parsedArgs,
            callerId: this.callerId,
            callSid: this.callSid,
            mode: this.mode,
            status: 'SCHEDULED',
            timestamp: new Date().toISOString()
        };
        appendData(leadsFilePath, leadData);
        await sendEmailReport('SUCCESS', leadData);
        result = { success: true };
      } else if (name === 'report_interaction') {
        const interactionData = {
            id: Date.now(),
            ...parsedArgs,
            callerId: this.callerId,
            callSid: this.callSid,
            mode: this.mode,
            timestamp: new Date().toISOString()
        };
        appendData(interactionsFilePath, interactionData);
        await sendEmailReport('REPORT', interactionData);
        result = { success: true };
      } else if (name === 'end_call') {
        logger.info(`Initiating 10-second end call sequence for ${this.callSid}`);

        // Final goodbye instruction
        const goodbyeInstruction = {
            type: "conversation.item.create",
            item: {
                type: "message",
                role: "system",
                content: [{
                    type: "input_text",
                    text: "Say a short, polite goodbye."
                }]
            }
        };
        this.sendToOpenAI(goodbyeInstruction);
        this.sendToOpenAI({ type: "response.create" });

        setTimeout(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.close();
            }
            if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
                this.openaiWs.close();
            }
        }, 10000); // 10-second delay to allow final goodbye audio to finish
        result = { status: 'ending_call_in_10s' };
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
      this.callSid = data.start.callSid; // explicitly set callSid

      const params = data.start.customParameters || {};
      this.callerId = params.callerId || this.callerId || 'unknown';
      this.mode = params.mode || this.mode || 'inbound';

      logger.info(`Stream started: ${this.streamSid}, callerId: ${this.callerId}, mode: ${this.mode}`);

      // Initialize OpenAI session now that we have stream parameters (if OpenAI is already connected)
      if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
        this.sendSessionUpdate();
      }

    } else if (data.event === 'media') {
        const audioAppend = {
            type: 'input_audio_buffer.append',
            audio: data.media.payload
        };
        this.sendToOpenAI(audioAppend);
    }
  }
}
