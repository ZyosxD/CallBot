import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/config.js';
import { getSystemPrompt } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendEmail } from './emailService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LEADS_FILE = path.join(__dirname, '../data/leads.json');
const INTERACTIONS_FILE = path.join(__dirname, '../data/interactions.json');

export class OpenAIRealtimeService {
  constructor(ws, callSid, context = 'inbound', clientData = {}) {
    this.ws = ws;
    this.callSid = callSid;
    this.context = context;
    this.clientData = clientData;
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
        this.sendSessionUpdate();
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
        turn_detection: { type: 'server_vad', silence_duration_ms: 1500 },
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        voice: 'coral',
        instructions: getSystemPrompt(this.context, this.clientData),
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Schedule a technical assessment when the customer agrees (The Yes).",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the contact person" },
                companyName: { type: "string", description: "Name of the company" },
                verifiedPhone: { type: "string", description: "Verified phone number" },
                appointmentTime: { type: "string", description: "Proposed date and time for the call" },
                needs: { type: "string", description: "Summary of identified needs (Internet, VoIP, IT)" }
              },
              required: ["contactName", "companyName", "verifiedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report an interaction that did not result in an appointment (Not interested, Call later, voicemail).",
            parameters: {
              type: "object",
              properties: {
                result: { type: "string", enum: ["not_interested", "call_later", "voicemail", "other"], description: "Outcome of the call" },
                details: { type: "string", description: "Details or notes about the interaction" }
              },
              required: ["result"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call gracefully.",
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
            result = { status: 'ending' };
        }

      // Send result back to OpenAI
      const functionOutput = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify(result || {})
        }
      };
      this.sendToOpenAI(functionOutput);

      // Trigger a response generation if not ending
      if (name !== 'end_call') {
          this.sendToOpenAI({ type: 'response.create' });
      }

    } catch (error) {
      logger.error(`Error executing function ${name}:`, error);
    }
  }

  async scheduleAppointment(args) {
    logger.info('Scheduling appointment:', args);
    try {
      // 1. Save to leads.json
      let leads = [];
      if (fs.existsSync(LEADS_FILE)) {
          const leadsData = fs.readFileSync(LEADS_FILE, 'utf8');
          leads = JSON.parse(leadsData);
      }

      const newLead = {
        ...args,
        callSid: this.callSid,
        callerId: this.clientData.callerId,
        timestamp: new Date().toISOString()
      };

      leads.push(newLead);
      fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));

      // 2. Send Email (Green)
      const subject = `🟢 New Lead: ${args.companyName}`;
      const html = `
        <h2>New Appointment Scheduled</h2>
        <p><strong>Contact Name:</strong> ${args.contactName}</p>
        <p><strong>Company:</strong> ${args.companyName}</p>
        <p><strong>Verified Phone:</strong> ${args.verifiedPhone}</p>
        <p><strong>Caller ID:</strong> ${this.clientData.callerId || 'Unknown'}</p>
        <p><strong>Proposed Time:</strong> ${args.appointmentTime}</p>
        <p><strong>Needs:</strong> ${args.needs}</p>
      `;

      await sendEmail(subject, html);

      return { success: true, message: "Appointment scheduled and email sent." };
    } catch (error) {
      logger.error('Error scheduling appointment:', error);
      return { success: false, error: error.message };
    }
  }

  async reportInteraction(args) {
    logger.info('Reporting interaction:', args);
    try {
      // 1. Save to interactions.json
      let interactions = [];
      if (fs.existsSync(INTERACTIONS_FILE)) {
          const interactionsData = fs.readFileSync(INTERACTIONS_FILE, 'utf8');
          interactions = JSON.parse(interactionsData);
      }

      const newInteraction = {
        ...args,
        callSid: this.callSid,
        callerId: this.clientData.callerId,
        timestamp: new Date().toISOString()
      };

      interactions.push(newInteraction);
      fs.writeFileSync(INTERACTIONS_FILE, JSON.stringify(interactions, null, 2));

      // 2. Send Email (Orange)
      const subject = `🟠 Interaction Report: ${args.result}`;
      const html = `
        <h2>Interaction Report</h2>
        <p><strong>Result:</strong> ${args.result}</p>
        <p><strong>Caller ID:</strong> ${this.clientData.callerId || 'Unknown'}</p>
        <p><strong>Details:</strong> ${args.details}</p>
      `;

      await sendEmail(subject, html);

      return { success: true, message: "Interaction reported." };
    } catch (error) {
      logger.error('Error reporting interaction:', error);
      return { success: false, error: error.message };
    }
  }

  async endCall() {
    logger.info('Ending call gracefully');
    setTimeout(() => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.close();
        }
        if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
            this.openaiWs.close();
        }
    }, 10000); // 10 seconds delay
    return { success: true };
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
      logger.info(`Stream started: ${this.streamSid}`);
    } else if (data.event === 'media') {
        const audioAppend = {
            type: 'input_audio_buffer.append',
            audio: data.media.payload
        };
        this.sendToOpenAI(audioAppend);
    }
  }
}
