import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendSuccessReport, sendInteractionReport } from './emailService.js';
import { markCallEnded } from './dripService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LEADS_FILE = path.join(__dirname, '../data/leads.json');
const INTERACTIONS_FILE = path.join(__dirname, '../data/interactions.json');

export class OpenAIRealtimeService {
  constructor(ws, callSid, callerId, mode) {
    this.ws = ws;
    this.callSid = callSid;
    this.callerId = callerId;
    this.mode = mode; // 'inbound' or 'outbound'
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
        // We will send session update when Twilio stream starts, so we have the correct callerId and mode
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
        turn_detection: {
          type: 'server_vad',
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
            description: "Schedule a Technical Assessment after collecting all required data (The Trifecta).",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string" },
                companyName: { type: "string" },
                confirmedPhone: { type: "string" },
                appointmentTime: { type: "string" },
                notes: { type: "string" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Log the outcome if the user refuses, is not interested, or you hit voicemail.",
            parameters: {
              type: "object",
              properties: {
                status: { type: "string", enum: ["not_interested", "call_back_later", "voicemail"] },
                summary: { type: "string" }
              },
              required: ["status", "summary"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "Gracefully end the call after a successful scheduling or interaction log.",
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

    // Initial greeting for outbound to trigger speech right away
    if (this.mode === 'outbound') {
      this.sendToOpenAI({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'Start the conversation immediately with: "Hi! This is Sarah from 1Wire. Are you the one handling the tech, or should I ask for the Office Manager?"'
            }
          ]
        }
      });
      this.sendToOpenAI({ type: 'response.create' });
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
    const { name, arguments: args } = event;
    const parsedArgs = JSON.parse(args);
    const callId = event.call_id;

    logger.info(`Function call detected: ${name} with args: ${args}`);
    let result = null;

    try {
      if (name === 'schedule_appointment') {
        const leadData = {
          ...parsedArgs,
          callerId: this.callerId,
          timestamp: new Date().toISOString()
        };

        let leads = [];
        try { leads = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf-8')); } catch(e) {}
        leads.push(leadData);
        fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));

        await sendSuccessReport(leadData);
        result = { status: "success", message: "Appointment scheduled." };

      } else if (name === 'report_interaction') {
        const interactionData = {
          ...parsedArgs,
          callerId: this.callerId,
          timestamp: new Date().toISOString()
        };

        let interactions = [];
        try { interactions = JSON.parse(fs.readFileSync(INTERACTIONS_FILE, 'utf-8')); } catch(e) {}
        interactions.push(interactionData);
        fs.writeFileSync(INTERACTIONS_FILE, JSON.stringify(interactions, null, 2));

        await sendInteractionReport(interactionData);
        result = { status: "logged", message: "Interaction saved." };

      } else if (name === 'end_call') {
        result = { status: "ending", message: "Ending call in 10 seconds." };
        this.handleEndCall();
      }

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

  handleEndCall() {
    logger.info(`Scheduling call disconnect for SID ${this.callSid} in 10 seconds.`);

    // Instruct AI to say goodbye
    this.sendToOpenAI({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Please say a short, polite goodbye.' }]
      }
    });
    this.sendToOpenAI({ type: 'response.create' });

    setTimeout(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          logger.info(`Closing WebSocket for call ${this.callSid}`);
          this.ws.close();
      }
      if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
          this.openaiWs.close();
      }
      markCallEnded(this.callSid);
    }, 10000);
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

      if (data.start.customParameters) {
        this.callerId = data.start.customParameters.callerId || this.callerId;
        this.mode = data.start.customParameters.mode || this.mode;
      }

      logger.info(`Stream started: ${this.streamSid} | Mode: ${this.mode} | Caller: ${this.callerId}`);

      // Now that we have the stream and mode, initialize the session
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
