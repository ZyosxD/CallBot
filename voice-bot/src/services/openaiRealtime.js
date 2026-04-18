import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import twilio from 'twilio';
import fs from 'fs/promises';
import path from 'path';

// Email Service will be implemented later
const sendEmail = async (subject, text) => {
  try {
    const { sendEmailReport } = await import('./emailService.js');
    await sendEmailReport(subject, text);
  } catch (e) {
    logger.warn('Email service not ready: ' + e.message);
  }
};

const leadsPath = path.resolve('src/data/leads.json');
const interactionsPath = path.resolve('src/data/interactions.json');

export class OpenAIRealtimeService {
  constructor(ws, callSid, mode, callerId) {
    this.ws = ws;
    this.callSid = callSid;
    this.mode = mode;
    this.callerId = callerId;
    this.openaiWs = null;
    this.streamSid = null;

    this.isOpenAiConnected = false;
    this.isTwilioStarted = false;
    this.sessionInitialized = false;
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
    if (this.isOpenAiConnected && this.isTwilioStarted && !this.sessionInitialized) {
      this.sessionInitialized = true;
      this.sendSessionUpdate();

      // Force AI to speak first immediately after connection
      const greeting = this.mode === 'outbound'
        ? "Hello! Are you the person who handles the technology or should I ask for an Office Manager?"
        : "Hello! Thank you for calling 1Wire. Are you the person who handles the technology or should I ask for an Office Manager?";

      this.sendToOpenAI({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'system',
          content: [{ type: 'input_text', text: greeting }]
        }
      });
      this.sendToOpenAI({ type: 'response.create' });
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
            description: "Schedule a Technical Assessment. Only use when you have The Trifecta AND the exact time.",
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
            description: "Use when client is not interested, asks to call back later, or reaches voicemail.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Reason for reporting (e.g., 'not interested', 'voicemail')" },
                notes: { type: "string", description: "Any additional details" }
              },
              required: ["reason"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call conversation.",
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
    const callId = event.call_id;
    let parsedArgs = {};

    logger.info(`Function call detected: ${name} with args: ${args}`);

    try {
      if (args && args.trim() !== '') {
        parsedArgs = JSON.parse(args);
      }
    } catch (e) {
      logger.error(`SyntaxError parsing function arguments: ${e.message}`);
      // return early or let it proceed with empty args to fail gracefully
    }

    let result = null;

    try {
      if (name === 'schedule_appointment') {
        result = await this.handleScheduleAppointment(parsedArgs);
      } else if (name === 'report_interaction') {
        result = await this.handleReportInteraction(parsedArgs);
      } else if (name === 'end_call') {
        result = await this.handleEndCall();
      }

      // Send result back to OpenAI immediately to prevent hanging
      const functionOutput = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify(result || { status: 'success' })
        }
      };
      this.sendToOpenAI(functionOutput);

      // If it's not an end_call, trigger next response
      if (name !== 'end_call') {
        this.sendToOpenAI({ type: 'response.create' });
      }

    } catch (error) {
      logger.error(`Error executing function ${name}:`, error);
      // Send error back so it doesn't hang
      const functionOutput = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify({ error: error.message })
        }
      };
      this.sendToOpenAI(functionOutput);
    }
  }

  async handleScheduleAppointment(args) {
    const lead = {
      ...args,
      twilioCallerId: this.callerId,
      callSid: this.callSid,
      timestamp: new Date().toISOString()
    };

    // Save to leads.json
    try {
      const data = await fs.readFile(leadsPath, 'utf-8');
      const leads = JSON.parse(data);
      leads.push(lead);
      await fs.writeFile(leadsPath, JSON.stringify(leads, null, 2), 'utf-8');
    } catch (e) {
      logger.error('Failed to write to leads.json: ' + e.message);
    }

    // Send Success Email
    const subject = `🟢 SUCCESS: New Appointment - ${args.companyName}`;
    const text = `
Appointment Scheduled!
----------------------
Company: ${args.companyName}
Contact: ${args.contactName}
Time: ${args.appointmentTime}

Phone Comparison:
- Confirmed Verbal Phone: ${args.confirmedPhone}
- Twilio Caller ID: ${this.callerId}
    `;
    await sendEmail(subject, text);

    return { status: 'appointment_scheduled' };
  }

  async handleReportInteraction(args) {
    const interaction = {
      ...args,
      twilioCallerId: this.callerId,
      callSid: this.callSid,
      timestamp: new Date().toISOString()
    };

    // Save to interactions.json
    try {
      const data = await fs.readFile(interactionsPath, 'utf-8');
      const interactions = JSON.parse(data);
      interactions.push(interaction);
      await fs.writeFile(interactionsPath, JSON.stringify(interactions, null, 2), 'utf-8');
    } catch (e) {
      logger.error('Failed to write to interactions.json: ' + e.message);
    }

    // Send Report Email
    const subject = `🟠 REPORT: Interaction Logged`;
    const text = `
Interaction Logged
------------------
Reason: ${args.reason}
Notes: ${args.notes || 'N/A'}

Twilio Caller ID: ${this.callerId}
    `;
    await sendEmail(subject, text);

    return { status: 'interaction_logged' };
  }

  async handleEndCall() {
    logger.info(`Ending call ${this.callSid} in 10 seconds...`);

    // Send a polite goodbye message before closing
    this.sendToOpenAI({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'system',
        content: [{ type: 'input_text', text: "Say a short, polite goodbye." }]
      }
    });
    this.sendToOpenAI({ type: 'response.create' });

    setTimeout(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.close();
      }
    }, 10000);

    return { status: 'ending_call' };
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
      this.isTwilioStarted = true;
      logger.info(`Stream started: ${this.streamSid}`);
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
