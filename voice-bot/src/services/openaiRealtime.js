import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const leadsFilePath = path.join(__dirname, '../data/leads.json');
const interactionsFilePath = path.join(__dirname, '../data/interactions.json');

export class OpenAIRealtimeService {
  constructor(ws, callSid) {
    this.ws = ws;
    this.callSid = callSid;
    this.callerId = 'unknown';
    this.openaiWs = null;
    this.streamSid = null;
    this.isOpenAiConnected = false;
    this.isTwilioStarted = false;
    this.sessionUpdateSent = false;
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
    if (this.isOpenAiConnected && this.isTwilioStarted && !this.sessionUpdateSent) {
      this.sendSessionUpdate();
      this.sessionUpdateSent = true;
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
        instructions: prompts.systemInstruction,
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Schedule a Technical Assessment appointment after collecting all required details.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the person" },
                companyName: { type: "string", description: "Company name" },
                confirmedPhone: { type: "string", description: "Verbally confirmed best phone number" },
                appointmentTime: { type: "string", description: "Exact time for tomorrow" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Log interaction if client is not interested, wants a callback later, or reached voicemail.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Reason for reporting (e.g. not interested, voicemail)" }
              },
              required: ["reason"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the conversation after saying goodbye.",
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
    let parsedArgs;

    try {
      parsedArgs = JSON.parse(args);
    } catch (err) {
      logger.error('SyntaxError parsing function arguments:', err);
      return;
    }

    const callId = event.call_id;
    logger.info(`Function call detected: ${name} with args: ${args}`);
    let result = null;

    try {
      if (name === 'schedule_appointment') {
        // Save to leads.json
        const newLead = { ...parsedArgs, callSid: this.callSid, originalCallerId: this.callerId, timestamp: new Date().toISOString() };
        this.appendToFile(leadsFilePath, newLead);

        // Send email
        await sendSuccessEmail(newLead);
        result = { status: 'success' };
      } else if (name === 'report_interaction') {
        // Save to interactions.json
        const interaction = { ...parsedArgs, callSid: this.callSid, originalCallerId: this.callerId, timestamp: new Date().toISOString() };
        this.appendToFile(interactionsFilePath, interaction);

        // Send email
        await sendReportEmail(interaction);
        result = { status: 'reported' };
      } else if (name === 'end_call') {
        result = { status: 'ending' };

        // Send function_call_output immediately
        this.sendToOpenAI({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: callId,
            output: JSON.stringify(result)
          }
        });

        // Instruct a polite goodbye
        this.sendToOpenAI({ type: 'response.create' });

        // Delay closing
        setTimeout(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.close();
          }
        }, 10000);
        return; // Early return to avoid duplicate resolution
      }

      // Send result back to OpenAI for other functions
      const functionOutput = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify(result)
        }
      };
      this.sendToOpenAI(functionOutput);
      this.sendToOpenAI({ type: 'response.create' });

    } catch (error) {
      logger.error(`Error executing function ${name}:`, error);
    }
  }

  appendToFile(filePath, data) {
    try {
      let items = [];
      if (fs.existsSync(filePath)) {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        items = JSON.parse(fileContent);
      }
      items.push(data);
      fs.writeFileSync(filePath, JSON.stringify(items, null, 2));
    } catch (err) {
      logger.error(`Error writing to ${filePath}:`, err);
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
      if (data.start.customParameters && data.start.customParameters.callerId) {
        this.callerId = data.start.customParameters.callerId;
      }
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
