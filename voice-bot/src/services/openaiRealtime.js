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
const leadsPath = path.join(__dirname, '../data/leads.json');
const interactionsPath = path.join(__dirname, '../data/interactions.json');

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

  sendSessionUpdate() {
    const instructions = this.mode === 'inbound' ? prompts.SARAH_INBOUND : prompts.SARAH_OUTBOUND;

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
            description: "Schedule a technical assessment when the user says YES to the pitch and provides the exact time.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the person to ask for." },
                companyName: { type: "string", description: "Name of the company." },
                confirmedPhone: { type: "string", description: "The phone number verbally confirmed by the user." },
                appointmentTime: { type: "string", description: "The exact time agreed upon for the call tomorrow." }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Log the call if the client is not interested, asks to call back later, or it goes to voicemail.",
            parameters: {
              type: "object",
              properties: {
                notes: { type: "string", description: "Details about the interaction." },
                result: { type: "string", description: "Outcome (e.g., 'Not interested', 'Call back later', 'Voicemail')." }
              },
              required: ["result"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call gracefully after saying goodbye or hanging up the phone.",
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

  appendToFile(filePath, dataObj) {
    try {
      const data = fs.readFileSync(filePath, 'utf8');
      const json = JSON.parse(data);
      json.push(dataObj);
      fs.writeFileSync(filePath, JSON.stringify(json, null, 2));
    } catch (e) {
      logger.error(`Error appending to ${filePath}`, e);
    }
  }

  async handleFunctionCall(event) {
    const { name, arguments: args } = event;
    const callId = event.call_id;
    let parsedArgs = {};

    try {
      parsedArgs = JSON.parse(args);
    } catch (e) {
      logger.warn(`Failed to parse args for ${name}`, e);
    }

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
        this.appendToFile(leadsPath, lead);
        await sendSuccessEmail(lead);
        result = { status: 'success', message: 'Appointment scheduled and email sent.' };
      } else if (name === 'report_interaction') {
        const interaction = {
          callSid: this.callSid,
          callerId: this.callerId,
          ...parsedArgs,
          timestamp: new Date().toISOString()
        };
        this.appendToFile(interactionsPath, interaction);
        await sendReportEmail(interaction);
        result = { status: 'success', message: 'Interaction logged and reported.' };
      } else if (name === 'end_call') {
        logger.info(`Ending call ${this.callSid} in 10 seconds...`);

        result = { status: 'ending', message: 'Goodbye. Disconnecting in 10 seconds.' };

        setTimeout(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.close();
          }
          if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
            this.openaiWs.close();
          }
        }, 10000);
      }

      // Send result back to OpenAI to resolve the tool call before the socket closes
      const functionOutput = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify(result)
        }
      };
      this.sendToOpenAI(functionOutput);

      if (name === 'end_call') {
        // Instruct OpenAI to say a short, polite goodbye immediately before the 10-second wait starts
        this.sendToOpenAI({
          type: 'response.create',
          response: {
            instructions: "Say a short, polite goodbye to the user. Do not ask any questions or try to continue the conversation."
          }
        });
      } else {
        // Trigger normal response generation
        this.sendToOpenAI({ type: 'response.create' });
      }

    } catch (error) {
      logger.error(`Error executing function ${name}:`, error);
    }
  }

  checkAndInitializeSession() {
    if (this.isOpenAiConnected && this.isTwilioStarted) {
      logger.info('Both OpenAI and Twilio are ready. Initializing session...');
      this.sendSessionUpdate();

      // Start the conversation
      const greeting = this.mode === 'inbound'
        ? "Hello, this is Sarah from 1Wire, how can I help you today?"
        : "Hi, this is Sarah, do you handle the technology there or should I ask for the Office Manager?";

      this.sendToOpenAI({
        type: 'response.create',
        response: {
          instructions: `Start the conversation immediately. Say exactly: "${greeting}"`
        }
      });
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
      this.callSid = data.start.callSid; // explicitly update callSid
      logger.info(`Stream started: ${this.streamSid} for call ${this.callSid}`);
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
