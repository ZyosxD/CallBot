import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendEmailReport, formatAppointmentEmail, formatInteractionEmail } from './emailService.js';
import twilio from 'twilio';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class OpenAIRealtimeService {
  constructor(ws, callSid, callerId = 'unknown', mode = 'SARAH_INBOUND') {
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

        // Instruct OpenAI to speak first immediately upon connection
        this.sendToOpenAI({
          type: 'response.create',
          response: {
            instructions: "Start the conversation immediately by answering the phone or saying hello.",
          }
        });
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
          silence_duration_ms: 1500, // Important for Sarah persona
        },
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        voice: 'coral',
        instructions: this.mode === 'SARAH_OUTBOUND' ? prompts.SARAH_OUTBOUND : prompts.SARAH_INBOUND,
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Schedule a Technical Assessment when the user agrees.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Who should we ask for?" },
                companyName: { type: "string", description: "Name of the company" },
                confirmedPhone: { type: "string", description: "The confirmed phone number to call back" },
                appointmentTime: { type: "string", description: "The agreed upon time for the assessment" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report the outcome of the call if no appointment was scheduled (e.g., voicemail, not interested).",
            parameters: {
              type: "object",
              properties: {
                outcome: { type: "string", description: "Outcome of the call (e.g., voicemail, rejected)" },
                notes: { type: "string", description: "Brief notes about the interaction" }
              },
              required: ["outcome"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call. Must be called after the final goodbye.",
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
    let result = null;

    try {
      if (name === 'schedule_appointment') {
        result = await this.saveLead(parsedArgs);

        // Trigger email
        const { subject, html } = formatAppointmentEmail(parsedArgs, this.callerId);
        sendEmailReport(subject, html);

      } else if (name === 'report_interaction') {
        result = await this.saveInteraction(parsedArgs);

        // Trigger email
        const { subject, html } = formatInteractionEmail(parsedArgs, this.callerId);
        sendEmailReport(subject, html);

      } else if (name === 'end_call') {
        result = { status: 'ending_call' };

        // Say goodbye then hang up after 10s delay
        this.sendToOpenAI({
          type: 'response.create',
          response: {
            instructions: "Say a short, polite goodbye."
          }
        });

        setTimeout(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
              logger.info(`Closing WebSocket for call ${this.callSid} after 10s delay.`);
              this.ws.close();
          }
        }, 10000);
      }

      // Send result back to OpenAI
      const functionOutput = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify(result || { status: 'success' })
        }
      };
      this.sendToOpenAI(functionOutput);

      // If we didn't just end the call, trigger another response
      if (name !== 'end_call') {
          this.sendToOpenAI({ type: 'response.create' });
      }

    } catch (error) {
      logger.error(`Error executing function ${name}:`, error);
    }
  }

  async saveLead(data) {
      const leadsPath = path.join(__dirname, '../data/leads.json');
      let leads = [];
      try {
          const fileData = fs.readFileSync(leadsPath, 'utf8');
          leads = JSON.parse(fileData);
      } catch (e) {
          logger.warn('Could not read leads.json, creating new.');
      }

      leads.push({
          ...data,
          originalCallerId: this.callerId,
          timestamp: new Date().toISOString()
      });

      fs.writeFileSync(leadsPath, JSON.stringify(leads, null, 2));
      return { success: true };
  }

  async saveInteraction(data) {
      const interactionsPath = path.join(__dirname, '../data/interactions.json');
      let interactions = [];
      try {
          const fileData = fs.readFileSync(interactionsPath, 'utf8');
          interactions = JSON.parse(fileData);
      } catch (e) {
          logger.warn('Could not read interactions.json, creating new.');
      }

      interactions.push({
          ...data,
          callerId: this.callerId,
          timestamp: new Date().toISOString()
      });

      fs.writeFileSync(interactionsPath, JSON.stringify(interactions, null, 2));
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
      this.callSid = data.start.callSid; // Update from stream event
      this.streamSid = data.start.streamSid;
      logger.info(`Stream started: ${this.streamSid} for call: ${this.callSid}`);
    } else if (data.event === 'media') {
        const audioAppend = {
            type: 'input_audio_buffer.append',
            audio: data.media.payload
        };
        this.sendToOpenAI(audioAppend);
    }
  }
}
