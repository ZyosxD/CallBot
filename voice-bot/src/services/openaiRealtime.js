import WebSocket from 'ws';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';
import dayjs from 'dayjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LEADS_FILE = path.join(__dirname, '../data/leads.json');
const INTERACTIONS_FILE = path.join(__dirname, '../data/interactions.json');

export class OpenAIRealtimeService {
  constructor(ws, callSid, clientData = {}) {
    this.ws = ws;
    this.callSid = callSid;
    this.clientData = clientData; // Contains context like name, company, id
    this.openaiWs = null;
    this.streamSid = null;
    this.isClosing = false;
    this.startTime = Date.now();
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
        logger.info(`Connected to OpenAI Realtime API for call ${this.callSid}`);
        this.sendSessionUpdate();
      });

      this.openaiWs.on('message', (data) => {
        if (!this.isClosing) {
            this.handleOpenAIMessage(data);
        }
      });

      this.openaiWs.on('error', (error) => {
        logger.error('OpenAI WebSocket Error:', error);
      });

      this.openaiWs.on('close', () => {
        logger.info('OpenAI WebSocket Closed');
        if (!this.isClosing) {
             // If OpenAI closes unexpectedly, we should close Twilio too
             if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                 this.ws.close();
             }
        }
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
            silence_duration_ms: 1500,
        },
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        voice: 'coral',
        instructions: prompts.systemInstruction,
        modalities: ["text", "audio"],
        temperature: 0.6,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Schedule a technical assessment after getting the Trifecta (Name, Company, Phone, Time).",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the person to ask for" },
                companyName: { type: "string", description: "Exact company name" },
                phone: { type: "string", description: "Verified phone number" },
                dateTime: { type: "string", description: "Proposed date and time for the call" },
                notes: { type: "string", description: "Any other relevant notes" }
              },
              required: ["contactName", "companyName", "phone", "dateTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report an interaction (Not Interested, Voicemail, Call Back Later).",
            parameters: {
              type: "object",
              properties: {
                status: { type: "string", enum: ["Not Interested", "Voicemail", "Call Back Later", "Other"], description: "Outcome of the call" },
                summary: { type: "string", description: "Brief summary of what happened" }
              },
              required: ["status", "summary"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call gracefully.",
            parameters: {
              type: "object",
              properties: {
                  reason: { type: "string", description: "Reason for ending the call" }
              },
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
    let result = { success: true };

    try {
      if (name === 'schedule_appointment') {
        await this.handleScheduleAppointment(parsedArgs);
      } else if (name === 'report_interaction') {
        await this.handleReportInteraction(parsedArgs);
      } else if (name === 'end_call') {
        this.handleEndCall(parsedArgs);
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

      // Trigger a response generation ONLY if not ending call
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
        clientId: this.clientData.clientId,
        originalCompany: this.clientData.company, // From our DB
        timestamp: new Date().toISOString()
    };

    // Save to leads.json
    try {
        const fileContent = await fs.readFile(LEADS_FILE, 'utf-8');
        const leads = JSON.parse(fileContent);
        leads.push(lead);
        await fs.writeFile(LEADS_FILE, JSON.stringify(leads, null, 2));
    } catch (err) {
        logger.error('Error saving lead:', err);
    }

    // Send Email
    await sendSuccessEmail({
        name: args.contactName,
        company: args.companyName, // Confirmed company name
        phone: args.phone,
        dateTime: args.dateTime,
        notes: args.notes,
        twilioPhone: this.clientData.phone
    });
  }

  async handleReportInteraction(args) {
     const duration = Math.floor((Date.now() - this.startTime) / 1000);
     const interaction = {
         ...args,
         clientId: this.clientData.clientId,
         phone: this.clientData.phone, // Twilio phone
         duration: duration,
         timestamp: new Date().toISOString()
     };

     // Save to interactions.json
     try {
         const fileContent = await fs.readFile(INTERACTIONS_FILE, 'utf-8');
         const interactions = JSON.parse(fileContent);
         interactions.push(interaction);
         await fs.writeFile(INTERACTIONS_FILE, JSON.stringify(interactions, null, 2));
     } catch (err) {
         logger.error('Error saving interaction:', err);
     }

     // Send Email
     await sendReportEmail({
         status: args.status,
         twilioPhone: this.clientData.phone,
         confirmedPhone: null, // We don't have it in this case usually
         summary: args.summary,
         duration: duration
     });
  }

  handleEndCall(args) {
      logger.info('Ending call as requested by model.');
      this.isClosing = true;

      // Spec: Retardo de 10 segundos before closing socket
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
