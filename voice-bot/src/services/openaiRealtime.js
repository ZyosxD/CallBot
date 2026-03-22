import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendNotificationEmail } from './emailService.js';
import twilio from 'twilio';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const leadsPath = path.join(__dirname, '../data/leads.json');
const interactionsPath = path.join(__dirname, '../data/interactions.json');

export class OpenAIRealtimeService {
  constructor(ws, callSid) {
    this.ws = ws;
    this.callSid = callSid;
    this.callerId = 'unknown';
    this.mode = 'inbound';
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
            description: "Schedule a technical assessment after the user says YES. Collect the required Trifecta information before calling.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the person to ask for (IT Manager/Owner)" },
                companyName: { type: "string", description: "Name of the company" },
                confirmedPhone: { type: "string", description: "Verbally confirmed best number to call" },
                appointmentTime: { type: "string", description: "Exact time for tomorrow's call" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Log the interaction if the client is not interested, asks to call later, or hits a voicemail.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Reason for the report (e.g., 'not interested', 'call later', 'voicemail')" },
                summary: { type: "string", description: "Brief summary of the call" }
              },
              required: ["reason", "summary"]
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
          logConversation(this.callSid, 'Sarah', event.transcript);
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
        await this.handleEndCall();
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

      // Trigger a response generation
      this.sendToOpenAI({ type: 'response.create' });

    } catch (error) {
      logger.error(`Error executing function ${name}:`, error);
      // Send fallback result to not stall AI
      const errorOutput = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify({ error: error.message || 'Error occurred' })
        }
      };
      this.sendToOpenAI(errorOutput);
      this.sendToOpenAI({ type: 'response.create' });
    }
  }

  async scheduleAppointment(data) {
    const lead = { ...data, timestamp: new Date().toISOString(), twilioCallerId: this.callerId };

    // Save to leads.json
    try {
      const leads = JSON.parse(fs.readFileSync(leadsPath, 'utf8'));
      leads.push(lead);
      fs.writeFileSync(leadsPath, JSON.stringify(leads, null, 2));
    } catch (e) {
      logger.error('Failed to save to leads.json', e);
    }

    // Send email report
    await sendNotificationEmail({
      type: 'SUCCESS',
      callerId: this.callerId,
      confirmedPhone: data.confirmedPhone,
      data: data
    });

    return { success: true, message: 'Appointment saved. You can close the call politely.' };
  }

  async reportInteraction(data) {
    const interaction = { ...data, timestamp: new Date().toISOString(), twilioCallerId: this.callerId };

    // Save to interactions.json
    try {
      const interactions = JSON.parse(fs.readFileSync(interactionsPath, 'utf8'));
      interactions.push(interaction);
      fs.writeFileSync(interactionsPath, JSON.stringify(interactions, null, 2));
    } catch (e) {
      logger.error('Failed to save to interactions.json', e);
    }

    // Send email report
    await sendNotificationEmail({
      type: 'REPORT',
      callerId: this.callerId,
      confirmedPhone: null, // Usually not collected if reported early
      data: data
    });

    return { success: true, message: 'Interaction logged. You can hang up politely.' };
  }

  async handleEndCall() {
    logger.info(`Ending call for ${this.callSid} in 10s...`);

    // Send one final response generation instructing AI to say goodbye politely
    this.sendToOpenAI({
        type: 'response.create',
        response: {
            instructions: 'Say a short, polite goodbye immediately.'
        }
    });

    setTimeout(() => {
        logger.info(`Closing sockets for ${this.callSid} after 10s delay.`);
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
        if (data.start.customParameters.callerId) {
          this.callerId = data.start.customParameters.callerId;
        }
        if (data.start.customParameters.mode) {
          this.mode = data.start.customParameters.mode;
        }
      }

      logger.info(`Stream started: ${this.streamSid} | CallerID: ${this.callerId} | Mode: ${this.mode}`);

      // Instruct AI to speak first
      const initialGreeting = this.mode === 'outbound'
        ? 'Say hello politely and ask: "Are you the one managing the technology or should I ask for the Office Manager?"'
        : 'Say a cheerful hello from 1Wire and ask how you can help them today.';

      this.sendToOpenAI({
        type: 'response.create',
        response: {
            instructions: initialGreeting
        }
      });

    } else if (data.event === 'media') {
        const audioAppend = {
            type: 'input_audio_buffer.append',
            audio: data.media.payload
        };
        this.sendToOpenAI(audioAppend);
    }
  }
}