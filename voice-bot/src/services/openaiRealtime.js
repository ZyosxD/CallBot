import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import twilio from 'twilio';

// We'll add the data dependencies later for tools, importing them here to avoid reference errors later.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const leadsPath = path.join(__dirname, '../data/leads.json');
const interactionsPath = path.join(__dirname, '../data/interactions.json');

const readData = (filePath) => {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify([]));
      return [];
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    logger.error(`Error reading ${filePath}:`, error);
    return [];
  }
};

const appendData = (filePath, item) => {
  try {
    const data = readData(filePath);
    data.push(item);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (error) {
    logger.error(`Error writing ${filePath}:`, error);
  }
};

export class OpenAIRealtimeService {
  constructor(ws, callSid, callerId = 'unknown', mode = 'inbound') {
    this.ws = ws;
    this.callSid = callSid;
    this.callerId = callerId;
    this.mode = mode;
    this.openaiWs = null;
    this.streamSid = null;
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
        // Do not send session update immediately, wait for Twilio start event
        // to correctly set the prompt based on mode and callerId.
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
    if (this.sessionUpdateSent) return;
    this.sessionUpdateSent = true;

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
            description: "Schedule a Technical Assessment after confirming Contact Name, Company Name, Phone, and Exact Time (The Trifecta).",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string" },
                companyName: { type: "string" },
                confirmedPhone: { type: "string" },
                appointmentTime: { type: "string", description: "e.g., Tomorrow at 10 AM" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Log the interaction if the caller is not interested, asks to call back later, or if it's a voicemail.",
            parameters: {
              type: "object",
              properties: {
                outcome: { type: "string", description: "e.g., 'Not interested', 'Call back later', 'Voicemail'" },
                notes: { type: "string", description: "Brief notes about the interaction" }
              },
              required: ["outcome", "notes"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call and hang up. Use only at the end of the conversation.",
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

    // Prompt the bot to start speaking
    if (this.mode === 'outbound') {
        const greeting = {
            type: "conversation.item.create",
            item: {
                type: "message",
                role: "user",
                content: [{ type: "input_text", text: "Start the conversation immediately by saying: 'Hi! Is this the person who handles the tech there, or should I ask for the Office Manager?'" }]
            }
        };
        this.sendToOpenAI(greeting);
    } else {
        const greeting = {
            type: "conversation.item.create",
            item: {
                type: "message",
                role: "user",
                content: [{ type: "input_text", text: "Start the conversation immediately by greeting the caller warmly." }]
            }
        };
        this.sendToOpenAI(greeting);
    }
    this.sendToOpenAI({ type: "response.create" });
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
        const { contactName, companyName, confirmedPhone, appointmentTime } = parsedArgs;

        appendData(leadsPath, {
          callSid: this.callSid,
          callerId: this.callerId,
          contactName,
          companyName,
          confirmedPhone,
          appointmentTime,
          timestamp: new Date().toISOString()
        });

        await sendSuccessEmail(contactName, companyName, confirmedPhone, appointmentTime, this.callerId);
        result = { status: "Success. Lead saved." };

      } else if (name === 'report_interaction') {
        const { outcome, notes } = parsedArgs;

        appendData(interactionsPath, {
          callSid: this.callSid,
          callerId: this.callerId,
          outcome,
          notes,
          timestamp: new Date().toISOString()
        });

        await sendReportEmail(this.callerId, outcome, notes);
        result = { status: "Interaction logged." };

      } else if (name === 'end_call') {
        logger.info(`Initiating end_call for ${this.callSid}`);

        // Instruct OpenAI to say goodbye before we close the socket
        const goodbye = {
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Say a short, polite goodbye right now." }]
          }
        };
        this.sendToOpenAI(goodbye);
        this.sendToOpenAI({ type: "response.create" });

        // Wait 10 seconds to allow the final message to play, then close the socket.
        setTimeout(() => {
            logger.info(`Closing WebSocket for ${this.callSid} after 10s delay`);
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.close();
            }
            if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
                this.openaiWs.close();
            }
        }, 10000);

        result = { status: "Ending call in 10 seconds." };
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

      // Trigger a response generation if it's not ending the call
      if (name !== 'end_call') {
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
      this.sendToOpenAI({ type: 'response.create' });
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

      // Safety check: sometimes the WebSocket might establish connection faster than Twilio's start event,
      // so we use the mode and callerId values captured in the callController logic which initializes this class.
      // But if Twilio sends custom params, we should extract them here just in case.
      const customParams = data.start.customParameters || {};
      if (customParams.callerId) {
          this.callerId = customParams.callerId;
      }
      if (customParams.mode) {
          this.mode = customParams.mode;
      }
      this.callSid = data.start.callSid;

      logger.info(`Stream started: ${this.streamSid}, CallSid: ${this.callSid}, CallerId: ${this.callerId}, Mode: ${this.mode}`);

      // Now that we have the stream parameters, we can send the session update
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
