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
const leadsFilePath = path.join(__dirname, '../data/leads.json');
const interactionsFilePath = path.join(__dirname, '../data/interactions.json');

const writeToFile = (filePath, data) => {
  if (fs.existsSync(filePath)) {
    const fileData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    fileData.push(data);
    fs.writeFileSync(filePath, JSON.stringify(fileData, null, 2));
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
    this.instructionPrompt = this.mode === 'outbound' ? prompts.SARAH_OUTBOUND : prompts.SARAH_INBOUND;
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
          silence_duration_ms: 1500
        },
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        voice: 'coral',
        instructions: this.instructionPrompt,
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Schedule a Technical Assessment appointment. Trigger ONLY when you have collected Contact Name, Company Name, Confirmed Phone, and exact Appointment Time.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the person handling technology" },
                companyName: { type: "string", description: "Name of the company" },
                confirmedPhone: { type: "string", description: "The confirmed best phone number to call back" },
                appointmentTime: { type: "string", description: "The exact date and time agreed for the appointment" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report an outcome where the user is not interested, asks to call later, or the call goes to voicemail.",
            parameters: {
              type: "object",
              properties: {
                outcome: { type: "string", description: "The outcome: Not Interested, Call Later, or Voicemail" },
                notes: { type: "string", description: "Brief notes about the interaction" },
                confirmedPhone: { type: "string", description: "The confirmed best phone number to call back (if any)" }
              },
              required: ["outcome", "notes"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call after completing the conversation. Call this at the very end to say goodbye.",
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

        // Start conversation immediately
        this.sendToOpenAI({
          type: 'response.create',
          response: {
            instructions: "Start the conversation immediately. Introduce yourself as Sarah from 1Wire and ask if they are the person handling technology or if you should speak to the office manager."
          }
        });
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
        const leadData = {
          callSid: this.callSid,
          callerId: this.callerId,
          timestamp: new Date().toISOString(),
          ...parsedArgs
        };
        writeToFile(leadsFilePath, leadData);
        await sendSuccessEmail(parsedArgs, this.callerId);
        result.message = "Appointment scheduled successfully.";
      } else if (name === 'report_interaction') {
        const interactionData = {
          callSid: this.callSid,
          callerId: this.callerId,
          timestamp: new Date().toISOString(),
          ...parsedArgs
        };
        writeToFile(interactionsFilePath, interactionData);
        await sendReportEmail(parsedArgs, this.callerId);
        result.message = "Interaction reported successfully.";
      } else if (name === 'end_call') {
        result.message = "Call ending in 10 seconds.";

        // Wait 10 seconds before closing to allow goodbye message
        setTimeout(async () => {
            try {
                if (this.callSid && this.callSid !== 'unknown') {
                    const client = twilio(config.twilio.accountSid, config.twilio.authToken);
                    await client.calls(this.callSid).update({ status: 'completed' });
                }

                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this.ws.close();
                }
                if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
                    this.openaiWs.close();
                }
                logger.info(`Call ${this.callSid} ended via end_call tool.`);
            } catch (error) {
                logger.error('Error ending call via Twilio:', error);
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

      // Trigger a response generation after tool call (unless ending)
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
      if (data.start.callSid) {
          this.callSid = data.start.callSid;
      }
      logger.info(`Stream started: ${this.streamSid} for Call: ${this.callSid}`);
    } else if (data.event === 'media') {
        const audioAppend = {
            type: 'input_audio_buffer.append',
            audio: data.media.payload
        };
        this.sendToOpenAI(audioAppend);
    }
  }
}