import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendEmailReport } from './emailService.js';
import twilio from 'twilio';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LEADS_FILE = path.join(__dirname, '../data/leads.json');
const INTERACTIONS_FILE = path.join(__dirname, '../data/interactions.json');

export class OpenAIRealtimeService {
  constructor(ws, callSid, callerId = null, mode = 'inbound') {
    this.ws = ws;
    this.callSid = callSid;
    this.callerId = callerId;
    this.mode = mode;
    this.openaiWs = null;
    this.streamSid = null;
    this.isEnding = false;
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
        // Defer sending session update until we get the start event with parameters
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
            description: "Schedule a technical assessment after getting the Trifecta + exact time",
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
            description: "Log interaction if the client is not interested, asks to call later, or reaches voicemail",
            parameters: {
              type: "object",
              properties: {
                notes: { type: "string" }
              },
              required: ["notes"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "Politely end the conversation and hang up",
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

    // Send an initial event so the AI speaks first
    this.sendToOpenAI({
      type: 'response.create',
      response: {
        instructions: 'Start the conversation immediately. Introduce yourself and ask how you can help (if inbound) or execute the Gatekeeper script (if outbound).'
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

  async handleFunctionCall(event) {
    const { name, arguments: args } = event;
    const parsedArgs = JSON.parse(args);
    const callId = event.call_id;

    logger.info(`Function call detected: ${name} with args: ${args}`);
    let result = null;

    try {
      if (name === 'schedule_appointment') {
        result = await this.scheduleAppointment(parsedArgs);
      } else if (name === 'report_interaction') {
        result = await this.reportInteraction(parsedArgs);
      } else if (name === 'end_call') {
        await this.endCall();
        result = { status: 'ending_call' };
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
        // Trigger a response generation if we are not ending the call
        this.sendToOpenAI({ type: 'response.create' });
      }

    } catch (error) {
      logger.error(`Error executing function ${name}:`, error);
    }
  }

  async scheduleAppointment(args) {
    const leadData = {
      id: Date.now(),
      originalCallerId: this.callerId,
      timestamp: new Date().toISOString(),
      ...args
    };

    try {
      let leads = [];
      if (fs.existsSync(LEADS_FILE)) {
        leads = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf-8'));
      }
      leads.push(leadData);
      fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));

      await sendEmailReport('success', leadData);
      return { status: 'appointment_scheduled_successfully' };
    } catch (e) {
      logger.error('Error saving lead:', e);
      return { status: 'error_saving_appointment' };
    }
  }

  async reportInteraction(args) {
    const interactionData = {
      id: Date.now(),
      originalCallerId: this.callerId,
      timestamp: new Date().toISOString(),
      ...args
    };

    try {
      let interactions = [];
      if (fs.existsSync(INTERACTIONS_FILE)) {
        interactions = JSON.parse(fs.readFileSync(INTERACTIONS_FILE, 'utf-8'));
      }
      interactions.push(interactionData);
      fs.writeFileSync(INTERACTIONS_FILE, JSON.stringify(interactions, null, 2));

      await sendEmailReport('report', interactionData);
      return { status: 'interaction_logged' };
    } catch (e) {
      logger.error('Error saving interaction:', e);
      return { status: 'error_saving_interaction' };
    }
  }

  async endCall() {
    if (this.isEnding) return;
    this.isEnding = true;
    logger.info(`Initiating 10-second end call delay for ${this.callSid}`);

    // Force a final goodbye before we hang up
    this.sendToOpenAI({
      type: 'response.create',
      response: {
        instructions: 'Say a short, polite goodbye right now as we are hanging up.'
      }
    });

    setTimeout(() => {
      logger.info(`10 seconds elapsed, closing sockets for ${this.callSid}`);
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.close();
      }
      if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
        this.openaiWs.close();
      }
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
        if (data.start.customParameters.mode) {
          this.mode = data.start.customParameters.mode;
        }
        if (data.start.customParameters.callerId) {
          this.callerId = data.start.customParameters.callerId;
        }
      }

      logger.info(`Stream started: ${this.streamSid}, mode: ${this.mode}, callerId: ${this.callerId}`);

      // Now that we have the parameters, send the session update
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
