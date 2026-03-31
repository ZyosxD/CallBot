import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const leadsPath = path.join(__dirname, '../data/leads.json');
const interactionsPath = path.join(__dirname, '../data/interactions.json');

export class OpenAIRealtimeService {
  constructor(ws, callSid, callerId, mode) {
    this.ws = ws;
    this.callSid = callSid;
    this.callerId = callerId;
    this.mode = mode;
    this.openaiWs = null;
    this.streamSid = null;
    this.isSessionReady = false;
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
        // If we already received the streamSid (from Twilio start event),
        // we can safely send the session update now.
        if (this.streamSid && !this.isSessionReady) {
           this.sendSessionUpdate();
           this.isSessionReady = true;
        }
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
        voice: 'coral', // Using Coral voice
        instructions: prompt,
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Schedule a Technical Assessment with a 1Wire Specialist. REQUIRES The Trifecta: Contact Name, Company Name, Confirmed Phone, and Exact Time.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Who we should ask for" },
                companyName: { type: "string", description: "Needed for fiber map" },
                confirmedPhone: { type: "string", description: "The confirmed best number to call" },
                appointmentTime: { type: "string", description: "The exact time for the human to call (e.g. Tomorrow at 10 AM)" },
                extraNotes: { type: "string", description: "Any extra notes about their needs" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Log an interaction where the user was not interested, asked to call back later, or hit a voicemail.",
            parameters: {
              type: "object",
              properties: {
                status: { type: "string", description: "e.g., NOT_INTERESTED, CALL_BACK, VOICEMAIL" },
                details: { type: "string", description: "A brief summary of what happened" }
              },
              required: ["status", "details"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the current conversation. Call this after saying goodbye.",
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

    // Force Sarah to start the conversation immediately
    const firstGreeting = this.mode === 'outbound'
      ? 'Start the conversation immediately by stating you are Sarah from 1Wire and ask for the technology manager.'
      : 'Start the conversation immediately by answering enthusiastically, "Thank you for calling 1Wire! This is Sarah, how can I help you today?"';

    this.sendToOpenAI({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: firstGreeting }]
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
    const { name, arguments: args, call_id: callId } = event;

    let parsedArgs = {};
    try {
        parsedArgs = JSON.parse(args);
    } catch (e) {
        logger.error(`Failed to parse JSON for tool ${name}: ${args}`);
        this.sendFunctionOutput(callId, { error: 'Invalid JSON parameters' });
        return;
    }

    logger.info(`Function call detected: ${name} with args: ${args}`);
    let result = null;

    try {
      if (name === 'schedule_appointment') {
        result = await this.handleScheduleAppointment(parsedArgs);
      } else if (name === 'report_interaction') {
        result = await this.handleReportInteraction(parsedArgs);
      } else if (name === 'end_call') {
        result = await this.handleEndCall(callId);
        // Do not trigger response.create after end_call
        return;
      }

      this.sendFunctionOutput(callId, result);
      this.sendToOpenAI({ type: 'response.create' });

    } catch (error) {
      logger.error(`Error executing function ${name}:`, error);
      this.sendFunctionOutput(callId, { error: 'Internal server error' });
    }
  }

  sendFunctionOutput(callId, result) {
      const functionOutput = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify(result)
        }
      };
      this.sendToOpenAI(functionOutput);
  }

  async handleScheduleAppointment(args) {
    const { contactName, companyName, confirmedPhone, appointmentTime, extraNotes } = args;

    // Save to leads.json
    try {
      let leads = [];
      if (fs.existsSync(leadsPath)) {
        leads = JSON.parse(fs.readFileSync(leadsPath, 'utf-8'));
      }
      leads.push({
        timestamp: new Date().toISOString(),
        callSid: this.callSid,
        callerId: this.callerId,
        contactName,
        companyName,
        confirmedPhone,
        appointmentTime,
        extraNotes
      });
      fs.writeFileSync(leadsPath, JSON.stringify(leads, null, 2), 'utf-8');
    } catch (e) {
      logger.error('Error saving to leads.json:', e);
    }

    // Send email
    await sendSuccessEmail(contactName, companyName, this.callerId, confirmedPhone, appointmentTime, extraNotes || 'None');

    return { status: 'success', message: 'Appointment scheduled successfully. Tell them a specialist will call them then.' };
  }

  async handleReportInteraction(args) {
    const { status, details } = args;

    // Save to interactions.json
    try {
      let interactions = [];
      if (fs.existsSync(interactionsPath)) {
        interactions = JSON.parse(fs.readFileSync(interactionsPath, 'utf-8'));
      }
      interactions.push({
        timestamp: new Date().toISOString(),
        callSid: this.callSid,
        callerId: this.callerId,
        status,
        details
      });
      fs.writeFileSync(interactionsPath, JSON.stringify(interactions, null, 2), 'utf-8');
    } catch (e) {
      logger.error('Error saving to interactions.json:', e);
    }

    // Send email
    await sendReportEmail(this.callerId, status, details);

    return { status: 'success', message: 'Interaction logged.' };
  }

  async handleEndCall(callId) {
    logger.info(`Ending call ${this.callSid} in 10 seconds...`);

    // We must return the function call output immediately so OpenAI does not hang.
    this.sendFunctionOutput(callId, { status: 'ending', message: 'The connection will drop in 10 seconds.' });

    // Prompt the AI to say goodbye
    this.sendToOpenAI({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Say a short, polite goodbye right now as we are hanging up.' }]
      }
    });
    this.sendToOpenAI({ type: 'response.create' });

    setTimeout(() => {
      logger.info(`Closing websocket for call ${this.callSid}`);
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.close();
      }
      if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
        this.openaiWs.close();
      }
    }, 10000); // 10s delay
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

      // Update CallSid if provided in start event
      if (data.start.callSid) {
        this.callSid = data.start.callSid;
      }

      logger.info(`Stream started: ${this.streamSid}`);

      // Now that we have the start event (and any custom parameters from the stream),
      // we can safely send the session update IF the OpenAI WebSocket is already open.
      if (!this.isSessionReady && this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
         this.sendSessionUpdate();
         this.isSessionReady = true;
      }

    } else if (data.event === 'media') {
        const audioAppend = {
            type: 'input_audio_buffer.append',
            audio: data.media.payload
        };
        this.sendToOpenAI(audioAppend);
    }
  }
}
