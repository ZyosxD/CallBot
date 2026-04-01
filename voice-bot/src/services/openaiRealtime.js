import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import twilio from 'twilio';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const leadsFilePath = path.join(__dirname, '../data/leads.json');
const interactionsFilePath = path.join(__dirname, '../data/interactions.json');

const appendToFile = (filePath, data) => {
    try {
        let items = [];
        if (fs.existsSync(filePath)) {
            items = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        }
        items.push(data);
        fs.writeFileSync(filePath, JSON.stringify(items, null, 2));
    } catch (e) {
        logger.error(`Error appending to ${filePath}:`, e);
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

    this.isOpenAiConnected = false;
    this.isTwilioStarted = false;
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
      }
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
            description: "Schedule a Technical Assessment. Use ONLY when you have collected all The Trifecta (name, company, phone) + time.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the person handling technology" },
                companyName: { type: "string", description: "Name of the company" },
                confirmedPhone: { type: "string", description: "The confirmed phone number to reach them at" },
                appointmentTime: { type: "string", description: "The agreed upon exact time tomorrow" },
                notes: { type: "string", description: "Any extra notes about internet/VoIP/IT pain points" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report when the client is not interested, wants a callback later, or it goes to voicemail.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Reason for reporting (e.g. Not interested, callback later, voicemail)" },
                notes: { type: "string", description: "Detailed notes on what was said" }
              },
              required: ["reason", "notes"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call when the conversation is over. Start this function, then say a polite goodbye.",
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

    // Initial greeting if AI is meant to speak first
    if (this.mode === 'outbound' || this.mode === 'inbound') {
        setTimeout(() => {
             this.sendToOpenAI({
                type: 'conversation.item.create',
                item: {
                    type: 'message',
                    role: 'user',
                    content: [{
                        type: 'input_text',
                        text: "Start the conversation immediately. Say: 'Hi! Am I speaking with the person who handles technology or should I ask for the Office Manager?'"
                    }]
                }
            });
            this.sendToOpenAI({ type: 'response.create' });
        }, 500);
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
    const { name, arguments: argsString } = event;
    const callId = event.call_id;

    let parsedArgs;
    try {
        parsedArgs = JSON.parse(argsString);
    } catch (e) {
        logger.error(`SyntaxError parsing function arguments for ${name}:`, e);
        return; // Don't crash
    }

    logger.info(`Function call detected: ${name} with args: ${argsString}`);
    let result = null;

    try {
      if (name === 'schedule_appointment') {
        const leadData = {
            ...parsedArgs,
            callerId: this.callerId,
            callSid: this.callSid,
            timestamp: new Date().toISOString()
        };
        appendToFile(leadsFilePath, leadData);
        await sendSuccessEmail(leadData);
        result = { status: "Success. Lead captured and email sent." };
      } else if (name === 'report_interaction') {
        const interactionData = {
            ...parsedArgs,
            callerId: this.callerId,
            callSid: this.callSid,
            timestamp: new Date().toISOString()
        };
        appendToFile(interactionsFilePath, interactionData);
        await sendReportEmail(interactionData);
        result = { status: "Report recorded." };
      } else if (name === 'end_call') {
        result = { status: "Call ending in 10 seconds." };
        setTimeout(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.close();
            }
        }, 10000);
      }

      // Send result back to OpenAI to resolve the tool call
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
         // Trigger a response generation for normal functions
         this.sendToOpenAI({ type: 'response.create' });
      } else {
         // Tell it to say goodbye
         this.sendToOpenAI({
            type: 'conversation.item.create',
            item: {
                type: 'message',
                role: 'user',
                content: [{
                    type: 'input_text',
                    text: "Say a short, polite goodbye right now."
                }]
            }
         });
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
      // explicitly update callSid in case it wasn't available
      if (data.start.callSid) {
          this.callSid = data.start.callSid;
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
