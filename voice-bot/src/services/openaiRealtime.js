import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger from '../utils/logger.js';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const leadsFilePath = path.join(__dirname, '../data/leads.json');
const interactionsFilePath = path.join(__dirname, '../data/interactions.json');

const appendToFile = (filePath, data) => {
    try {
        let currentData = [];
        if (fs.existsSync(filePath)) {
            const fileContent = fs.readFileSync(filePath, 'utf8');
            if (fileContent) currentData = JSON.parse(fileContent);
        }
        currentData.push(data);
        fs.writeFileSync(filePath, JSON.stringify(currentData, null, 2));
    } catch (error) {
        logger.error(`Error writing to ${filePath}:`, error);
    }
};

export class OpenAIRealtimeService {
  constructor(ws, callSid, callerId, mode) {
    this.ws = ws;
    this.callSid = callSid;
    this.callerId = callerId;
    this.mode = mode;
    this.openaiWs = null;
    this.streamSid = null;
    this.connected = false;
  }

  connect() {
    const url = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01';
    this.openaiWs = new WebSocket(url, {
      headers: {
        'Authorization': `Bearer ${config.openai.apiKey}`,
        'OpenAI-Beta': 'realtime=v1',
      },
    });

    this.openaiWs.on('open', () => {
      logger.info('Connected to OpenAI Realtime API');
      this.connected = true;
      this.sendSessionUpdate();
    });

    this.openaiWs.on('message', (data) => {
      this.handleOpenAIMessage(JSON.parse(data));
    });

    this.openaiWs.on('close', () => {
      logger.info('Disconnected from OpenAI Realtime API');
      this.connected = false;
    });

    this.openaiWs.on('error', (error) => {
      logger.error('OpenAI WebSocket Error:', error);
    });
  }

  sendSessionUpdate() {
    const prompt = this.mode === 'outbound' ? prompts.SARAH_OUTBOUND : prompts.SARAH_INBOUND;

    const sessionUpdate = {
      type: 'session.update',
      session: {
        instructions: prompt,
        voice: 'coral',
        turn_detection: {
            type: "server_vad",
            silence_duration_ms: 1500
        },
        tools: [
          {
            type: 'function',
            name: 'schedule_appointment',
            description: 'Schedule a Technical Assessment. Requires collecting contactName, companyName, confirmedPhone, and appointmentTime first.',
            parameters: {
              type: 'object',
              properties: {
                contactName: { type: 'string', description: 'Name of the contact person (IT Manager/Owner)' },
                companyName: { type: 'string', description: 'Name of the company' },
                confirmedPhone: { type: 'string', description: 'The best phone number to reach them (verified verbally)' },
                appointmentTime: { type: 'string', description: 'The exact date and time for the appointment' },
              },
              required: ['contactName', 'companyName', 'confirmedPhone', 'appointmentTime'],
            },
          },
          {
            type: 'function',
            name: 'report_interaction',
            description: 'Report interaction if the client is not interested, asks to call later, or it goes to voicemail.',
            parameters: {
              type: 'object',
              properties: {
                reason: { type: 'string', description: 'Reason for the report (e.g., Not Interested, Call Later, Voicemail)' },
                notes: { type: 'string', description: 'Any additional notes about the interaction' },
              },
              required: ['reason', 'notes'],
            },
          },
          {
            type: 'function',
            name: 'end_call',
            description: 'End the current call after a polite goodbye.',
            parameters: {
              type: 'object',
              properties: {},
            },
          },
        ],
      },
    };
    this.sendToOpenAI(sessionUpdate);

    // Prompt OpenAI to start the conversation immediately
    const greetingText = this.mode === 'outbound' ? "Hi, is this the person handling the technology for the office?" : "Hi, thank you for calling 1Wire. How can I help you today?";

    this.sendToOpenAI({
        type: 'response.create',
        response: {
            instructions: `Start the conversation immediately by saying: "${greetingText}"`
        }
    });
  }

  handleTwilioMedia(data) {
    if (data.event === 'start') {
      this.streamSid = data.start.streamSid;
      this.callSid = data.start.callSid; // explicitly update callSid
      logger.info(`Started media stream: ${this.streamSid} for call ${this.callSid}`);
    } else if (data.event === 'media' && this.connected) {
      this.sendToOpenAI({
        type: 'input_audio_buffer.append',
        audio: data.media.payload,
      });
    }
  }

  handleOpenAIMessage(data) {
    if (data.type === 'response.audio.delta' && data.delta) {
      this.sendToTwilio({
        event: 'media',
        streamSid: this.streamSid,
        media: {
          payload: data.delta,
        },
      });
    }

    if (data.type === 'response.function_call_arguments.done') {
      this.handleFunctionCall(data);
    }
  }

  async handleFunctionCall(data) {
    const functionName = data.name;
    const callId = data.call_id;
    let args;
    try {
        args = JSON.parse(data.arguments);
    } catch (e) {
        logger.error(`Error parsing function arguments: ${e.message}`);
        return;
    }

    logger.info(`Function called: ${functionName} with args:`, args);

    if (functionName === 'schedule_appointment') {
        const { contactName, companyName, confirmedPhone, appointmentTime } = args;

        appendToFile(leadsFilePath, {
            callSid: this.callSid,
            callerId: this.callerId,
            contactName,
            companyName,
            confirmedPhone,
            appointmentTime,
            timestamp: new Date().toISOString()
        });

        await sendSuccessEmail(this.callerId, contactName, companyName, confirmedPhone, appointmentTime);

        this.sendToOpenAI({
            type: 'conversation.item.create',
            item: {
                type: 'function_call_output',
                call_id: callId,
                output: 'Appointment scheduled successfully. Confirm with the user and say goodbye.',
            }
        });
        this.sendToOpenAI({ type: 'response.create' });

    } else if (functionName === 'report_interaction') {
        const { reason, notes } = args;

        appendToFile(interactionsFilePath, {
            callSid: this.callSid,
            callerId: this.callerId,
            reason,
            notes,
            timestamp: new Date().toISOString()
        });

        await sendReportEmail(this.callerId, reason, notes);

        this.sendToOpenAI({
            type: 'conversation.item.create',
            item: {
                type: 'function_call_output',
                call_id: callId,
                output: 'Interaction reported. End the call politely.',
            }
        });
        this.sendToOpenAI({ type: 'response.create' });

    } else if (functionName === 'end_call') {
        this.sendToOpenAI({
            type: 'conversation.item.create',
            item: {
                type: 'function_call_output',
                call_id: callId,
                output: 'Ending call. Say a final polite goodbye.',
            }
        });

        this.sendToOpenAI({
            type: 'response.create',
            response: {
                instructions: 'Say a short, polite goodbye right now.'
            }
        });

        logger.info(`Closing connection for call ${this.callSid} in 10 seconds.`);
        setTimeout(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.close();
            }
        }, 10000);
    }
  }

  sendToOpenAI(data) {
    if (this.connected && this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
      this.openaiWs.send(JSON.stringify(data));
    }
  }

  sendToTwilio(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }
}
