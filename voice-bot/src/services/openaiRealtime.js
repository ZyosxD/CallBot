import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendEmail } from './emailService.js';
import dayjs from 'dayjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LEADS_FILE = path.join(__dirname, '../data/leads.json');
const INTERACTIONS_FILE = path.join(__dirname, '../data/interactions.json');

export class OpenAIRealtimeService {
  constructor(ws, callSid, callerId, mode) {
    this.ws = ws;
    this.callSid = callSid;
    this.callerId = callerId;
    this.mode = mode;
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
        turn_detection: {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 1500
        },
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        voice: 'coral', // Sarah's voice
        instructions: prompts.systemInstruction(this.mode),
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Schedule an appointment after collecting all required details (Name, Company, Verified Phone, Time)",
            parameters: {
              type: "object",
              properties: {
                name: { type: "string", description: "Name of the contact" },
                company: { type: "string", description: "Company name" },
                phone: { type: "string", description: "Verified phone number" },
                time: { type: "string", description: "Agreed time for the appointment" },
                notes: { type: "string", description: "Any additional notes or needs identified" }
              },
              required: ["name", "company", "phone", "time"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report the outcome of an interaction if no appointment was scheduled (e.g. not interested, voicemail, call back later)",
            parameters: {
              type: "object",
              properties: {
                outcome: { type: "string", enum: ["not_interested", "callback_later", "voicemail", "transferred", "other"] },
                details: { type: "string", description: "Details about the conversation" }
              },
              required: ["outcome", "details"]
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

    // Initial Greeting to ensure AI speaks first
    this.sendToOpenAI({
        type: 'response.create',
        response: {
            instructions: "Start the conversation immediately based on your instructions."
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
    let result = { success: true }; // Default result

    try {
      if (name === 'schedule_appointment') {
        await this.handleScheduleAppointment(parsedArgs);
        result = { success: true, message: "Appointment scheduled and email sent." };
      } else if (name === 'report_interaction') {
        await this.handleReportInteraction(parsedArgs);
        result = { success: true, message: "Interaction reported." };
      } else if (name === 'end_call') {
        await this.handleEndCall();
        result = { success: true, message: "Ending call." };
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

      // Trigger a response generation if not ending call
      if (name !== 'end_call') {
          this.sendToOpenAI({ type: 'response.create' });
      }

    } catch (error) {
      logger.error(`Error executing function ${name}:`, error);
    }
  }

  async handleScheduleAppointment(args) {
    const lead = {
        ...args,
        callSid: this.callSid,
        originalCallerId: this.callerId, // Compare with args.phone
        timestamp: new Date().toISOString()
    };

    // Save to leads.json
    try {
        const leads = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8'));
        leads.push(lead);
        fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
    } catch (e) {
        logger.error('Error saving lead:', e);
    }

    // Send Success Email (Green)
    const subject = `🟢 New Appointment: ${args.name} @ ${args.company}`;
    const body = `
      <h2>New Appointment Scheduled</h2>
      <p><strong>Name:</strong> ${args.name}</p>
      <p><strong>Company:</strong> ${args.company}</p>
      <p><strong>Phone (Confirmed):</strong> ${args.phone}</p>
      <p><strong>Caller ID:</strong> ${this.callerId}</p>
      <p><strong>Time:</strong> ${args.time}</p>
      <p><strong>Notes:</strong> ${args.notes || 'None'}</p>
    `;
    await sendEmail(subject, body);
  }

  async handleReportInteraction(args) {
    const interaction = {
        ...args,
        callSid: this.callSid,
        callerId: this.callerId,
        timestamp: new Date().toISOString()
    };

    // Save to interactions.json
    try {
        const interactions = JSON.parse(fs.readFileSync(INTERACTIONS_FILE, 'utf8'));
        interactions.push(interaction);
        fs.writeFileSync(INTERACTIONS_FILE, JSON.stringify(interactions, null, 2));
    } catch (e) {
        logger.error('Error saving interaction:', e);
    }

    // Send Report Email (Orange)
    const subject = `🟠 Interaction Report: ${args.outcome} - ${this.callerId}`;
    const body = `
      <h2>Interaction Report</h2>
      <p><strong>Outcome:</strong> ${args.outcome}</p>
      <p><strong>Details:</strong> ${args.details}</p>
      <p><strong>Caller ID:</strong> ${this.callerId}</p>
    `;
    await sendEmail(subject, body);
  }

  async handleEndCall() {
    logger.info(`Ending call ${this.callSid} in 10 seconds...`);
    setTimeout(() => {
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
