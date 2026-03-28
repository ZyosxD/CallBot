import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendEmail } from './emailService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class OpenAIRealtimeService {
  constructor(ws, callSid, callerId, mode) {
    this.ws = ws;
    this.callSid = callSid;
    this.callerId = callerId;
    this.mode = mode;
    this.openaiWs = null;
    this.streamSid = null;
    this.systemInstruction = this.mode === 'outbound' ? prompts.SARAH_OUTBOUND : prompts.SARAH_INBOUND;
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
        // Defer sendSessionUpdate until Twilio start event is received
        // so we have the correct callerId and mode.
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
          threshold: 0.5,
          prefix_padding_ms: 300,
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
            description: "Schedule a Technical Assessment after confirming The Trifecta (Contact Name, Company Name, Confirmed Phone) and Exact Time.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Who should we ask for? IT Manager/Owner" },
                companyName: { type: "string", description: "Mandatory to see the fiber map" },
                confirmedPhone: { type: "string", description: "Is this the best number to call?" },
                appointmentTime: { type: "string", description: "What time tomorrow?" },
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Log interaction if client is not interested, asks to call back later, or it's a voicemail.",
            parameters: {
              type: "object",
              properties: {
                notes: { type: "string", description: "Summary of interaction or outcome." },
              },
              required: ["notes"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call and say goodbye to the client.",
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

    // Prompt the AI to start speaking first
    this.sendToOpenAI({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Start the conversation immediately by greeting me.' }]
      }
    });
    this.sendToOpenAI({ type: 'response.create' });
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
          this.appendToLog('interactions.json', { callSid: this.callSid, role: 'Assistant', text: event.transcript });
      }

      if (event.type === 'conversation.item.input_audio_transcription.completed') {
          logConversation(this.callSid, 'User', event.transcript);
          this.appendToLog('interactions.json', { callSid: this.callSid, role: 'User', text: event.transcript });
      }

      if (event.type === 'response.function_call_arguments.done') {
        await this.handleFunctionCall(event);
      }

    } catch (error) {
      logger.error('Error parsing OpenAI message:', error);
    }
  }

  appendToLog(filename, data) {
    const filePath = path.join(__dirname, `../data/${filename}`);
    try {
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, '[]');
      }
      const logs = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      logs.push({ ...data, timestamp: new Date().toISOString() });
      fs.writeFileSync(filePath, JSON.stringify(logs, null, 2));
    } catch (err) {
      logger.error(`Failed to append log to ${filename}`, err);
    }
  }

  async handleFunctionCall(event) {
    const { name, arguments: args } = event;
    const callId = event.call_id;

    logger.info(`Function call detected: ${name} with args: ${args}`);
    let result = null;

    try {
      const parsedArgs = JSON.parse(args);
      if (name === 'schedule_appointment') {
        const details = {
          originalCallerId: this.callerId,
          ...parsedArgs
        };
        this.appendToLog('leads.json', details);
        await sendEmail('SUCCESS', details);
        result = { status: 'success' };
      } else if (name === 'report_interaction') {
        const details = {
          originalCallerId: this.callerId,
          confirmedPhone: null,
          ...parsedArgs
        };
        await sendEmail('REPORT', details);
        result = { status: 'logged' };
      } else if (name === 'end_call') {
        result = { status: 'ending_call' };

        // Instruct the AI to say goodbye
        this.sendToOpenAI({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Say a short, polite goodbye.' }]
          }
        });
        this.sendToOpenAI({ type: 'response.create' });

        // Delayed closure to allow AI to speak
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
      this.callSid = data.start.callSid; // explicitly updating from Twilio start event
      this.systemInstruction = this.mode === 'outbound' ? prompts.SARAH_OUTBOUND : prompts.SARAH_INBOUND;
      this.sendSessionUpdate(); // Now send the session update with correct mode
      logger.info(`Stream started: ${this.streamSid} for call ${this.callSid}`);
    } else if (data.event === 'media') {
        const audioAppend = {
            type: 'input_audio_buffer.append',
            audio: data.media.payload
        };
        this.sendToOpenAI(audioAppend);
    }
  }
}
