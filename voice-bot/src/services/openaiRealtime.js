import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import twilio from 'twilio';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class OpenAIRealtimeService {
  constructor(ws, callSid, callerId, mode) {
    this.ws = ws;
    this.callSid = callSid;
    this.callerId = callerId;
    this.mode = mode; // 'inbound' or 'outbound'
    this.openaiWs = null;
    this.streamSid = null;
    this.isSessionConfigured = false;
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
        // Do not configure session immediately here.
        // Wait for Twilio's "start" event which has the correct mode and callerId.
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

  configureSession() {
    if (this.isSessionConfigured) return;

    this.sendSessionUpdate();

    // Determine the initial greeting logic based on mode
    let initialGreeting = '';
    if (this.mode === 'outbound') {
      initialGreeting = 'Start the conversation immediately. Introduce yourself briefly as Sarah from 1Wire and ask if they manage the technology or if you should ask for an Office Manager.';
    } else {
      initialGreeting = 'Start the conversation immediately. Introduce yourself briefly as Sarah from 1Wire, ask how you can help, and quickly pivot to selling our internet or VoIP services depending on their needs.';
    }

    setTimeout(() => {
      this.sendToOpenAI({
        type: 'response.create',
        response: {
          instructions: initialGreeting
        }
      });
    }, 500);

    this.isSessionConfigured = true;
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
            description: "Schedule a technical assessment after collecting all required information (contact name, company name, confirmed phone, and exact time).",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the person" },
                companyName: { type: "string", description: "Name of the company" },
                confirmedPhone: { type: "string", description: "Verbally confirmed phone number to call back" },
                appointmentTime: { type: "string", description: "The exact agreed time tomorrow" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Log the interaction if the lead is not interested, asks to call back later, or it goes to voicemail.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Reason for logging (e.g., 'not interested', 'call later', 'voicemail')" }
              },
              required: ["reason"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the current call immediately.",
            parameters: {
              type: "object",
              properties: {}
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
    const parsedArgs = JSON.parse(args);
    const callId = event.call_id;

    logger.info(`Function call detected: ${name} with args: ${args}`);
    let result = { status: 'success' };

    try {
      if (name === 'schedule_appointment') {
        const { contactName, companyName, confirmedPhone, appointmentTime } = parsedArgs;

        // Save to leads.json
        const leadsPath = path.join(__dirname, '../data/leads.json');
        let leads = [];
        if (fs.existsSync(leadsPath)) {
            leads = JSON.parse(fs.readFileSync(leadsPath, 'utf8'));
        }
        leads.push({
            contactName, companyName, confirmedPhone, appointmentTime, callerId: this.callerId, timestamp: new Date().toISOString()
        });
        fs.writeFileSync(leadsPath, JSON.stringify(leads, null, 2));

        // Send Success Email
        await sendSuccessEmail(contactName, companyName, confirmedPhone, this.callerId, appointmentTime);

        result = { status: 'Appointment scheduled successfully.' };

      } else if (name === 'report_interaction') {
        const { reason } = parsedArgs;

        // Save to interactions.json
        const interactionsPath = path.join(__dirname, '../data/interactions.json');
        let interactions = [];
        if (fs.existsSync(interactionsPath)) {
            interactions = JSON.parse(fs.readFileSync(interactionsPath, 'utf8'));
        }
        interactions.push({
            reason, callerId: this.callerId, timestamp: new Date().toISOString()
        });
        fs.writeFileSync(interactionsPath, JSON.stringify(interactions, null, 2));

        // Send Report Email
        await sendReportEmail(reason, this.callerId);

        result = { status: 'Interaction reported successfully.' };

      } else if (name === 'end_call') {
        result = { status: 'Ending call...' };

        // Wait 10 seconds before closing to allow AI to say goodbye
        setTimeout(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.close();
          }
          if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
            this.openaiWs.close();
          }

          // Use Twilio REST to update the call to completed
          const client = twilio(config.twilio.accountSid, config.twilio.authToken);
          client.calls(this.callSid).update({ status: 'completed' }).catch(e => logger.error('Error ending Twilio call:', e));
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

      // Trigger a response generation
      this.sendToOpenAI({ type: 'response.create' });

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
      this.callSid = data.start.callSid; // Update from Twilio start event just to be safe

      // Attempt to extract custom params
      if (data.start.customParameters) {
          if (data.start.customParameters.callerId) this.callerId = data.start.customParameters.callerId;
          if (data.start.customParameters.mode) this.mode = data.start.customParameters.mode;
      }

      logger.info(`Stream started: ${this.streamSid} for CallSid: ${this.callSid} (Mode: ${this.mode})`);

      // Now that we have the exact mode, configure the session and trigger initial greeting
      this.configureSession();

    } else if (data.event === 'media') {
        const audioAppend = {
            type: 'input_audio_buffer.append',
            audio: data.media.payload
        };
        this.sendToOpenAI(audioAppend);
    }
  }
}
