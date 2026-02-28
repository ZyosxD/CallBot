import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendReportEmail } from './emailService.js';
import twilio from 'twilio';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const leadsPath = path.join(__dirname, '../data/leads.json');
const interactionsPath = path.join(__dirname, '../data/interactions.json');

const appendToFile = (filePath, data) => {
  try {
    let currentData = [];
    if (fs.existsSync(filePath)) {
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      if (fileContent) {
        currentData = JSON.parse(fileContent);
      }
    }
    currentData.push(data);
    fs.writeFileSync(filePath, JSON.stringify(currentData, null, 2));
  } catch (err) {
    logger.error(`Failed to append to ${filePath}:`, err);
  }
};

export class OpenAIRealtimeService {
  constructor(ws, callSid, callerId, mode) {
    this.ws = ws;
    this.callSid = callSid;
    this.callerId = callerId;
    this.mode = mode; // 'inbound' or 'outbound'
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
    const systemInstruction = this.mode === 'outbound' ? prompts.SARAH_OUTBOUND : prompts.SARAH_INBOUND;

    const sessionUpdate = {
      type: 'session.update',
      session: {
        turn_detection: { type: 'server_vad', silence_duration_ms: 1500 },
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        voice: 'coral',
        instructions: systemInstruction,
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Schedule a technical assessment after securing the 'Trifecta'. Only use when the user agreed to an appointment and all required parameters are collected.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the person" },
                companyName: { type: "string", description: "Name of the company" },
                confirmedPhone: { type: "string", description: "The confirmed verbal phone number for the call" },
                appointmentTime: { type: "string", description: "The exact time agreed upon" },
                notes: { type: "string", description: "Any needs or notes identified during the call" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report a call outcome where the user was not interested, asked to call later, or if a voicemail was reached.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Reason for the report, e.g., 'Not interested', 'Call later', 'Voicemail'" },
                notes: { type: "string", description: "Any relevant information captured during the call" }
              },
              required: ["reason"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call and disconnect the connection. Call this when the conversation is completely finished and a farewell has been spoken.",
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

    // Prompt the AI to start speaking first
    const greetingText = this.mode === 'outbound'
      ? "Start the conversation immediately by greeting them according to the gatekeeper script."
      : "Start the conversation immediately with the inbound greeting.";

    this.sendToOpenAI({
      type: 'response.create',
      response: {
        instructions: greetingText
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
    let result = null;

    try {
      if (name === 'schedule_appointment') {
        const lead = {
          callSid: this.callSid,
          callerId: this.callerId,
          ...parsedArgs,
          timestamp: new Date().toISOString()
        };
        appendToFile(leadsPath, lead);
        await sendReportEmail({
          type: 'success',
          callId: this.callSid,
          callerId: this.callerId,
          confirmedPhone: parsedArgs.confirmedPhone,
          name: parsedArgs.contactName,
          company: parsedArgs.companyName,
          time: parsedArgs.appointmentTime,
          notes: parsedArgs.notes
        });
        result = { status: 'success', message: 'Appointment scheduled and email sent.' };
      } else if (name === 'report_interaction') {
        const interaction = {
          callSid: this.callSid,
          callerId: this.callerId,
          ...parsedArgs,
          timestamp: new Date().toISOString()
        };
        appendToFile(interactionsPath, interaction);
        await sendReportEmail({
          type: 'report',
          callId: this.callSid,
          callerId: this.callerId,
          notes: `Reason: ${parsedArgs.reason}. Notes: ${parsedArgs.notes || 'None'}`
        });
        result = { status: 'success', message: 'Interaction reported.' };
      } else if (name === 'end_call') {
        result = { status: 'success', message: 'Ending call in 10 seconds...' };
        setTimeout(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.close();
          }
          if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
            this.openaiWs.close();
          }
          logger.info(`Call ended by AI for CallSid: ${this.callSid}`);
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
          // Trigger a response generation if we didn't end the call
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
      logger.info(`Stream started: ${this.streamSid} for CallSid: ${this.callSid}`);
    } else if (data.event === 'media') {
        const audioAppend = {
            type: 'input_audio_buffer.append',
            audio: data.media.payload
        };
        this.sendToOpenAI(audioAppend);
    }
  }
}
