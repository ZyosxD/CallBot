import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendEmailReport } from './emailService.js';

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
        // We wait for Twilio 'start' event to send session.update
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
            description: "Schedule a technical assessment after getting the Trifecta (Contact Name, Company Name, Verified Phone) and the exact time.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string" },
                companyName: { type: "string" },
                confirmedPhone: { type: "string" },
                appointmentTime: { type: "string" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report the outcome of the interaction when the user is not interested, asks to call later, or reaches a voicemail.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Why the call ended or outcome" }
              },
              required: ["reason"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call after the conversation is complete.",
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

    // Send a first message to start the conversation
    const greetingText = this.mode === 'outbound'
      ? "Hi, this is Sarah with 1Wire. Are you the person who handles technology, or should I ask for an Office Manager?"
      : "Hi, thank you for calling 1Wire. This is Sarah, how can I help you today?";

    this.sendToOpenAI({
      type: 'response.create',
      response: {
        instructions: `Start the conversation immediately by saying exactly this greeting: "${greetingText}"`
      }
    });
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

  appendToFile(filePath, dataObj) {
    try {
      let data = [];
      if (fs.existsSync(filePath)) {
        data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      }
      data.push(dataObj);
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (e) {
      logger.error(`Error writing to ${filePath}`, e);
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
          callSid: this.callSid,
          callerId: this.callerId,
          ...parsedArgs,
          timestamp: new Date().toISOString()
        };
        this.appendToFile(path.join(__dirname, '../data/leads.json'), lead);
        sendEmailReport('🟢 SUCCESS', this.callerId, parsedArgs.confirmedPhone, parsedArgs);
        result = { status: 'appointment_scheduled' };

      } else if (name === 'report_interaction') {
        const interaction = {
          callSid: this.callSid,
          callerId: this.callerId,
          ...parsedArgs,
          timestamp: new Date().toISOString()
        };
        this.appendToFile(path.join(__dirname, '../data/interactions.json'), interaction);
        sendEmailReport('🟠 REPORT', this.callerId, this.callerId, parsedArgs);
        result = { status: 'interaction_reported' };

      } else if (name === 'end_call') {
        result = { status: 'ending_call' };

        // Let OpenAI say a final goodbye
        this.sendToOpenAI({
          type: 'response.create',
          response: {
            instructions: "The conversation has ended. Say a short, polite goodbye immediately."
          }
        });

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

      if (name !== 'end_call') {
        this.sendToOpenAI({ type: 'response.create' });
      }

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
      this.callSid = data.start.callSid; // explicitly update
      logger.info(`Stream started: ${this.streamSid}`);
      this.sendSessionUpdate();
    } else if (data.event === 'media') {
        const audioAppend = {
            type: 'input_audio_buffer.append',
            audio: data.media.payload
        };
        this.sendToOpenAI(audioAppend);
    }
  }
}
