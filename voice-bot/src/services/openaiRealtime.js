import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/config.js';
import { getSystemPrompt } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { markCallEnded } from './dripService.js';
import { sendLeadNotification, sendInteractionReport } from './emailService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LEADS_FILE = path.join(__dirname, '../data/leads.json');
const INTERACTIONS_FILE = path.join(__dirname, '../data/interactions.json');

export class OpenAIRealtimeService {
  constructor(ws, callSid, clientData = {}, context = 'inbound') {
    this.ws = ws;
    this.callSid = callSid;
    this.clientData = clientData;
    this.context = context;
    this.openaiWs = null;
    this.streamSid = null;
    this.closeTimeout = null;
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
        this.endInteraction();
      });

    } catch (error) {
      logger.error('Error connecting to OpenAI:', error);
    }
  }

  sendSessionUpdate() {
    const systemInstruction = getSystemPrompt(this.context, this.clientData);
    const sessionUpdate = {
      type: 'session.update',
      session: {
        turn_detection: {
            type: 'server_vad',
            silence_duration_ms: 1500
        },
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        voice: 'coral', // Sarah uses Coral
        instructions: systemInstruction,
        modalities: ["text", "audio"],
        temperature: 0.7, // Slightly lower for more strict adherence
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Schedule a technical assessment when the customer agrees.",
            parameters: {
              type: "object",
              properties: {
                name: { type: "string", description: "Contact Name" },
                company: { type: "string", description: "Company Name" },
                phone: { type: "string", description: "Verified Phone Number" },
                time: { type: "string", description: "Requested Time (e.g., Tomorrow at 2pm)" },
                notes: { type: "string", description: "Any specific pain points or notes" }
              },
              required: ["name", "company", "phone", "time"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report the outcome of a call if no appointment was made (Not Interested, Call Back, Voicemail).",
            parameters: {
              type: "object",
              properties: {
                outcome: { type: "string", enum: ["Not Interested", "Call Back Later", "Voicemail", "Wrong Number", "Other"] },
                summary: { type: "string", description: "Brief summary of what happened." }
              },
              required: ["outcome", "summary"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call gracefully after saying goodbye.",
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
    let result = { status: 'success' };

    try {
      if (name === 'schedule_appointment') {
        await this.handleScheduleAppointment(parsedArgs);
        result = { message: "Appointment scheduled and email sent." };
      } else if (name === 'report_interaction') {
        await this.handleReportInteraction(parsedArgs);
        result = { message: "Interaction reported." };
      } else if (name === 'end_call') {
        this.handleEndCall(); // This initiates the shutdown sequence
        result = { message: "Ending call in 10 seconds." };
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

      // Trigger a response generation so the bot can say something like "Great, talk to you then!" before hanging up
      // if end_call was called, it might say "Goodbye" then the timeout kills it.
      if (name !== 'end_call') {
          this.sendToOpenAI({ type: 'response.create' });
      } else {
           // For end_call, we usually want it to just finish speaking if it was mid-sentence or acknowledge.
           // But typically end_call is called at the end.
           this.sendToOpenAI({ type: 'response.create' });
      }

    } catch (error) {
      logger.error(`Error executing function ${name}:`, error);
    }
  }

  async handleScheduleAppointment(data) {
    const lead = {
        ...data,
        callerId: this.clientData.phone || 'Unknown', // From Drip or Inbound
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

    // Send Email
    await sendLeadNotification(lead);
  }

  async handleReportInteraction(data) {
    const report = {
        ...data,
        phone: this.clientData.phone || this.callSid,
        timestamp: new Date().toISOString()
    };

    // Save to interactions.json
    try {
        const interactions = JSON.parse(fs.readFileSync(INTERACTIONS_FILE, 'utf8'));
        interactions.push(report);
        fs.writeFileSync(INTERACTIONS_FILE, JSON.stringify(interactions, null, 2));
    } catch (e) {
        logger.error('Error saving interaction:', e);
    }

    // Send Email
    await sendInteractionReport(report);
  }

  handleEndCall() {
    logger.info('Bot requested end call. Closing in 10s...');

    if (this.closeTimeout) clearTimeout(this.closeTimeout);

    this.closeTimeout = setTimeout(() => {
        logger.info('Closing connection now.');
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.close();
        }
        if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
            this.openaiWs.close();
        }
    }, 10000); // 10 seconds delay
  }

  endInteraction() {
      // Called when WebSocket closes
      if (this.closeTimeout) clearTimeout(this.closeTimeout);
      markCallEnded(); // Notify Drip Engine
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
