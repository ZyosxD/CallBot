import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendReportEmail } from './emailService.js';
import fs from 'fs';
import path from 'path';
import twilio from 'twilio';

const leadsFile = path.resolve('src/data/leads.json');
const interactionsFile = path.resolve('src/data/interactions.json');

export class OpenAIRealtimeService {
  constructor(ws, callSid) {
    this.ws = ws;
    this.callSid = callSid;
    this.callerId = 'unknown'; // Will be set from the controller
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
        // We will send the session update later, after we also receive the Twilio 'start' event
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

  async checkAndInitializeSession() {
    if (this.isOpenAiConnected && this.isTwilioStarted) {
      await this.sendSessionUpdate();

      // Force the AI to speak first
      const initialResponse = {
        type: 'response.create',
        response: {
          instructions: 'Start the conversation immediately by greeting the user politely according to the persona.'
        }
      };
      this.sendToOpenAI(initialResponse);
    }
  }

  async sendSessionUpdate() {
    // Determine mode from the WebSocket or assume inbound if not specified
    // For this example, we check if there's an active outbound call from the drip service
    let mode = 'inbound';
    try {
      const dripService = await import('./dripService.js');
      if (dripService.activeCallSid === this.callSid) {
        mode = 'outbound';
      }
    } catch (e) {
      // ignore
    }

    const persona = mode === 'outbound' ? prompts.SARAH_OUTBOUND : prompts.SARAH_INBOUND;

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
        instructions: persona,
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Schedule a technical assessment after the client agrees to a sales pitch.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the person to ask for (IT Manager or Owner)" },
                companyName: { type: "string", description: "Company Name" },
                confirmedPhone: { type: "string", description: "The confirmed phone number" },
                appointmentTime: { type: "string", description: "The agreed appointment time" },
                notes: { type: "string", description: "Any extra notes from the call" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report an interaction when the client is not interested, asks to call back later, or it's a voicemail.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Why the interaction did not lead to an appointment (e.g., Not interested, Call back later, Voicemail)" },
                notes: { type: "string", description: "Details about the call" }
              },
              required: ["reason"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "Ends the conversation politely. Call this tool after using either schedule_appointment or report_interaction.",
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
    let parsedArgs = {};
    const callId = event.call_id;

    logger.info(`Function call detected: ${name} with args: ${args}`);

    try {
      parsedArgs = JSON.parse(args);
    } catch (e) {
      logger.error('Failed to parse tool arguments:', e);
    }

    let result = null;

    try {
      if (name === 'schedule_appointment') {
        result = await this.executeScheduleAppointment(parsedArgs);
      } else if (name === 'report_interaction') {
        result = await this.executeReportInteraction(parsedArgs);
      } else if (name === 'end_call') {
        result = await this.executeEndCall();
      }

      // Send result back to OpenAI so it doesn't hang
      const functionOutput = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify(result || { status: "success" })
        }
      };
      this.sendToOpenAI(functionOutput);

      // Trigger a response generation
      if (name !== 'end_call') {
        this.sendToOpenAI({ type: 'response.create' });
      }

    } catch (error) {
      logger.error(`Error executing function ${name}:`, error);

      const errorOutput = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify({ error: error.message })
        }
      };
      this.sendToOpenAI(errorOutput);
      this.sendToOpenAI({ type: 'response.create' });
    }
  }

  async executeScheduleAppointment(args) {
    let leads = [];
    try {
      if (fs.existsSync(leadsFile)) {
        leads = JSON.parse(fs.readFileSync(leadsFile, 'utf8'));
      }
    } catch(e) {}

    const lead = {
      ...args,
      timestamp: new Date().toISOString(),
      callSid: this.callSid,
      callerId: this.callerId
    };
    leads.push(lead);

    fs.writeFileSync(leadsFile, JSON.stringify(leads, null, 2));

    const subject = '🟢 SUCCESS: Technical Assessment Scheduled';
    const body = `
Contact Name: ${args.contactName}
Company Name: ${args.companyName}
Original Caller ID: ${this.callerId}
Confirmed Phone: ${args.confirmedPhone}
Appointment Time: ${args.appointmentTime}
Notes: ${args.notes || 'None'}
    `;
    await sendReportEmail(subject, body);

    return { status: "appointment_scheduled" };
  }

  async executeReportInteraction(args) {
    let interactions = [];
    try {
      if (fs.existsSync(interactionsFile)) {
        interactions = JSON.parse(fs.readFileSync(interactionsFile, 'utf8'));
      }
    } catch(e) {}

    const interaction = {
      ...args,
      timestamp: new Date().toISOString(),
      callSid: this.callSid,
      callerId: this.callerId
    };
    interactions.push(interaction);

    fs.writeFileSync(interactionsFile, JSON.stringify(interactions, null, 2));

    const subject = '🟠 REPORT: Interaction Logged';
    const body = `
Reason: ${args.reason}
Original Caller ID: ${this.callerId}
Notes: ${args.notes || 'None'}
    `;
    await sendReportEmail(subject, body);

    return { status: "interaction_logged" };
  }

  async executeEndCall() {
    logger.info(`Initiating end call sequence for ${this.callSid}`);

    // Instruct the AI to say goodbye
    this.sendToOpenAI({
      type: 'response.create',
      response: {
        instructions: 'Say a short, polite goodbye and tell them we will be in touch, then stop speaking.'
      }
    });

    // Close the socket after 10 seconds to allow for the goodbye
    setTimeout(() => {
      logger.info(`Executing delayed socket close for ${this.callSid}`);
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.close();
      }
      if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
        this.openaiWs.close();
      }

      // Also forcefully unlock outbound drip if needed
      try {
         import('./dripService.js').then(({ markCallEnded }) => {
            markCallEnded(this.callSid);
         }).catch(() => {});
      } catch (e) {}

    }, 10000);

    return { status: "ending_call_in_10_seconds" };
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
      // We read callSid again just in case, but controller also sets it
      this.callSid = data.start.callSid;
      logger.info(`Stream started: ${this.streamSid} for CallSid ${this.callSid}`);

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
