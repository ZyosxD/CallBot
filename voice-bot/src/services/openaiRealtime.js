import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';
import fs from 'fs';
import path from 'path';

const LEADS_FILE = path.join(process.cwd(), 'src', 'data', 'leads.json');
const INTERACTIONS_FILE = path.join(process.cwd(), 'src', 'data', 'interactions.json');

export class OpenAIRealtimeService {
  constructor(ws, callSid, callerId) {
    this.ws = ws;
    this.callSid = callSid;
    this.callerId = callerId;
    this.openaiWs = null;
    this.streamSid = null;
    this.mode = 'inbound';
    this.isOpenAiConnected = false;
    this.isTwilioStarted = false;
  }

  setMode(mode) {
    this.mode = mode;
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
      if (this.isOpenAiConnected && this.isTwilioStarted) {
          this.sendSessionUpdate();
          this.triggerInitialGreeting();
      }
  }

  sendSessionUpdate() {
    const instructions = this.mode === 'outbound' ? prompts.SARAH_OUTBOUND : prompts.SARAH_INBOUND;

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
        instructions: instructions,
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Schedule a technical assessment after collecting The Trifecta (Contact Name, Company Name, Verified Phone, Exact Time).",
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
            description: "Report the interaction if the client is not interested, asks to call back later, or it goes to voicemail.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string" },
                details: { type: "string" }
              },
              required: ["reason"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call gracefully after saying goodbye.",
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

  triggerInitialGreeting() {
    const message = this.mode === 'outbound'
        ? "Hi there! This is Sarah from 1Wire, how are you doing today?"
        : "Thank you for calling 1Wire! This is Sarah, how can I help you today?";

    this.sendToOpenAI({
        type: 'conversation.item.create',
        item: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: message }]
        }
    });
    this.sendToOpenAI({ type: 'response.create' });
  }

  async handleOpenAIMessage(data) {
    try {
      const event = JSON.parse(data);

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
    let parsedArgs = {};
    let result = null;

    try {
        parsedArgs = JSON.parse(args);
    } catch(err) {
        logger.error(`SyntaxError parsing tool args for ${name}`, err);
    }

    logger.info(`Function call detected: ${name} with args: ${args}`);

    try {
      if (name === 'schedule_appointment') {
        const lead = { ...parsedArgs, callerId: this.callerId, callSid: this.callSid, timestamp: new Date().toISOString() };
        this.appendToFile(LEADS_FILE, lead);
        await sendSuccessEmail(lead, this.callerId);
        result = { status: 'appointment_scheduled' };
      } else if (name === 'report_interaction') {
        const interaction = { ...parsedArgs, callerId: this.callerId, callSid: this.callSid, timestamp: new Date().toISOString() };
        this.appendToFile(INTERACTIONS_FILE, interaction);
        await sendReportEmail(interaction, this.callerId);
        result = { status: 'interaction_reported' };
      } else if (name === 'end_call') {
          result = { status: 'ending_call' };

          this.sendToOpenAI({
              type: 'conversation.item.create',
              item: {
                  type: 'message',
                  role: 'assistant',
                  content: [{ type: 'text', text: "Thank you for your time. Have a wonderful day! Goodbye." }]
              }
          });
          this.sendToOpenAI({ type: 'response.create' });

          setTimeout(() => {
              if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                  this.ws.close();
              }
          }, 10000);
      }

      const functionOutput = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify(result || { status: 'ok' })
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

  appendToFile(filename, data) {
      try {
          let currentData = [];
          if (fs.existsSync(filename)) {
              const fileContent = fs.readFileSync(filename, 'utf-8');
              currentData = JSON.parse(fileContent);
          }
          currentData.push(data);
          fs.writeFileSync(filename, JSON.stringify(currentData, null, 2));
      } catch (err) {
          logger.error(`Error writing to ${filename}:`, err);
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
      this.callSid = data.start.callSid;
      logger.info(`Stream started: ${this.streamSid}`);
      this.isTwilioStarted = true;
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
