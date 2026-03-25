import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import twilio from 'twilio';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendEmailReport, formatSuccessEmail, formatReportEmail } from './emailService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const leadsPath = path.join(__dirname, '../data/leads.json');
const interactionsPath = path.join(__dirname, '../data/interactions.json');

const ensureFileExists = (filePath) => {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, '[]', 'utf8');
  }
};

ensureFileExists(leadsPath);
ensureFileExists(interactionsPath);

const saveToFile = (filePath, data) => {
  try {
    const fileData = fs.readFileSync(filePath, 'utf8');
    const json = JSON.parse(fileData);
    json.push(data);
    fs.writeFileSync(filePath, JSON.stringify(json, null, 2), 'utf8');
  } catch (error) {
    logger.error(`Error saving to ${filePath}:`, error);
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
            description: "Schedule a Technical Assessment after collecting The Trifecta",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Who we should ask for" },
                companyName: { type: "string", description: "Company name to check fiber map" },
                confirmedPhone: { type: "string", description: "Best number to call" },
                appointmentTime: { type: "string", description: "Exact time tomorrow for the call" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Log interaction if client is not interested, asks to call later, or hits voicemail",
            parameters: {
              type: "object",
              properties: {
                details: { type: "string", description: "Summary of why the client didn't want the assessment" }
              },
              required: ["details"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the conversation when all data is collected or client declines",
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

    // Initial greeting response if outbound
    if (this.mode === 'outbound') {
      const greeting = {
        type: 'response.create',
        response: {
          instructions: 'Start the conversation immediately with the Gatekeeper Navigation step. Speak directly.'
        }
      };
      this.sendToOpenAI(greeting);
    } else {
        const greeting = {
            type: 'response.create',
            response: {
                instructions: 'Start the conversation immediately with a helpful receptionist greeting.'
            }
        };
        this.sendToOpenAI(greeting);
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
        saveToFile(leadsPath, { ...parsedArgs, twilioCallerId: this.callerId, timestamp: new Date().toISOString() });
        const { subject, body } = formatSuccessEmail(parsedArgs, this.callerId);
        await sendEmailReport(subject, body);
        result = { status: 'success' };
      } else if (name === 'report_interaction') {
        saveToFile(interactionsPath, { ...parsedArgs, twilioCallerId: this.callerId, timestamp: new Date().toISOString() });
        const { subject, body } = formatReportEmail(parsedArgs.details, this.callerId);
        await sendEmailReport(subject, body);
        result = { status: 'logged' };
      } else if (name === 'end_call') {
        result = { status: 'ending' };

        // Final goodbye response
        const goodbye = {
            type: 'response.create',
            response: {
                instructions: 'Say a short, polite goodbye.'
            }
        };
        this.sendToOpenAI(goodbye);

        setTimeout(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
              this.ws.close();
          }
          if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
              this.openaiWs.close();
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
          // Trigger a response generation
          this.sendToOpenAI({ type: 'response.create' });
      }

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
