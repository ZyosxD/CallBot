import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';
import twilio from 'twilio';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../data');

export class OpenAIRealtimeService {
  constructor(ws, callSid, callerId = 'unknown', mode = 'inbound') {
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
        // Do not send session update until we have callerId and mode from Twilio Start event
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
            description: "Schedule a technical assessment after the client agrees and ALL 4 data points (Trifecta) are collected.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the person handling IT/technology" },
                companyName: { type: "string", description: "Name of the company" },
                confirmedPhone: { type: "string", description: "The confirmed verbal phone number to reach them at" },
                appointmentTime: { type: "string", description: "The agreed upon date and time for the assessment" },
                additionalNotes: { type: "string", description: "Any other context discussed" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report the outcome if the client is not interested, went to voicemail, or asked to call back later.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Reason for the outcome (e.g., 'Not interested', 'Voicemail', 'Call back later')" },
                summary: { type: "string", description: "Summary of the interaction" }
              },
              required: ["reason", "summary"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "Politely end the conversation.",
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

    // After session configuration, instruct AI to speak first
    const initialGreeting = this.mode === 'outbound' ?
      "Hi, this is Sarah from 1Wire. Do you handle the technology, or should I ask for an Office Manager?" :
      "Thank you for calling 1Wire, this is Sarah. Do you handle the technology, or should I ask for an Office Manager?";

    this.sendToOpenAI({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'system',
        content: [
          {
            type: 'input_text',
            text: `Start the conversation immediately! Say: "${initialGreeting}"`
          }
        ]
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
    const { name, arguments: args } = event;
    const parsedArgs = JSON.parse(args);
    const callId = event.call_id;

    logger.info(`Function call detected: ${name} with args: ${args}`);
    let result = null;

    try {
      if (name === 'schedule_appointment') {
        const lead = { id: Date.now(), callerId: this.callerId, ...parsedArgs };

        const leadsFile = path.join(DATA_DIR, 'leads.json');
        const leads = JSON.parse(fs.readFileSync(leadsFile, 'utf8'));
        leads.push(lead);
        fs.writeFileSync(leadsFile, JSON.stringify(leads, null, 2));

        await sendSuccessEmail(parsedArgs.contactName, parsedArgs.companyName, this.callerId, parsedArgs.confirmedPhone, parsedArgs.appointmentTime, parsedArgs.additionalNotes);
        result = { status: 'appointment_scheduled' };

      } else if (name === 'report_interaction') {
        const interaction = { id: Date.now(), callerId: this.callerId, ...parsedArgs };

        const interactionsFile = path.join(DATA_DIR, 'interactions.json');
        const interactions = JSON.parse(fs.readFileSync(interactionsFile, 'utf8'));
        interactions.push(interaction);
        fs.writeFileSync(interactionsFile, JSON.stringify(interactions, null, 2));

        await sendReportEmail(this.callerId, parsedArgs.summary, parsedArgs.reason);
        result = { status: 'interaction_logged' };

      } else if (name === 'end_call') {
        // Send a final goodbye text
        this.sendToOpenAI({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'system',
            content: [{ type: 'input_text', text: "Politely say goodbye and end the conversation." }]
          }
        });
        this.sendToOpenAI({ type: 'response.create' });

        result = { status: 'ending_call' };

        // Wait 10 seconds before hanging up the socket
        setTimeout(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
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
          output: JSON.stringify(result)
        }
      };
      this.sendToOpenAI(functionOutput);

      if (name !== 'end_call') {
        this.sendToOpenAI({ type: 'response.create' });
      }

    } catch (error) {
      logger.error(`Error executing function ${name}:`, error);
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
      this.callSid = data.start.callSid;

      if (data.start.customParameters) {
        this.callerId = data.start.customParameters.callerId || 'unknown';
        this.mode = data.start.customParameters.mode || 'inbound';
      }

      logger.info(`Stream started: ${this.streamSid} | CallerID: ${this.callerId} | Mode: ${this.mode}`);
      this.sendSessionUpdate();

    } else if (data.event === 'media') {
        const audioAppend = {
            type: 'input_audio_buffer.append',
            audio: data.media.payload
        };
        this.sendToOpenAI(audioAppend);
    }
  }
}
