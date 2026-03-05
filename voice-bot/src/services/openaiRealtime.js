import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const leadsFilePath = path.join(__dirname, '../data/leads.json');
const interactionsFilePath = path.join(__dirname, '../data/interactions.json');

const appendToJsonFile = (filePath, dataObj) => {
  try {
    let currentData = [];
    if (fs.existsSync(filePath)) {
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      if (fileContent) {
        currentData = JSON.parse(fileContent);
      }
    }
    currentData.push(dataObj);
    fs.writeFileSync(filePath, JSON.stringify(currentData, null, 2), 'utf-8');
  } catch (err) {
    logger.error(`Error appending to ${filePath}:`, err);
  }
};

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
        this.sendSessionUpdate();

        // Trigger initial greeting based on mode
        const initialText = this.mode === 'outbound'
          ? "Hi, do you handle the tech there, um, or should I ask for an Office Manager?"
          : "Hi, thanks for calling! Are you calling about, um, our Local Fiber, VoIP, or IT services today?";

        this.sendToOpenAI({
          type: "response.create",
          response: {
            instructions: `Start the conversation immediately by saying: "${initialText}"`
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
    const systemPrompt = this.mode === 'outbound' ? prompts.SARAH_OUTBOUND : prompts.SARAH_INBOUND;

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
        voice: 'coral',
        instructions: systemPrompt,
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Schedule a Technical Assessment after confirming The Trifecta (Contact Name, Company Name, Confirmed Phone, Appointment Time).",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the person we should ask for" },
                companyName: { type: "string", description: "Name of the company" },
                confirmedPhone: { type: "string", description: "The verbally confirmed best phone number to call" },
                appointmentTime: { type: "string", description: "The confirmed time for the appointment" },
                notes: { type: "string", description: "Any notes about their needs (Internet, VoIP, IT)" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Log the interaction if they are not interested, want us to call back later, or if it hit voicemail.",
            parameters: {
              type: "object",
              properties: {
                outcome: { type: "string", description: "The outcome: Not Interested, Call Back Later, Voicemail, etc." },
                notes: { type: "string", description: "Any context about why they weren't interested or what happened." }
              },
              required: ["outcome"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "Ends the call. Use this at the very end of the conversation after saying goodbye.",
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
        // Enforce Trifecta
        if (!parsedArgs.contactName || !parsedArgs.companyName || !parsedArgs.confirmedPhone || !parsedArgs.appointmentTime) {
           result = { status: 'failed', reason: 'Missing required Trifecta information. You must collect Contact Name, Company Name, Confirmed Phone, and Appointment Time.' };
        } else {
            const leadData = {
                timestamp: new Date().toISOString(),
                callerId: this.callerId,
                mode: this.mode,
                ...parsedArgs
            };
            appendToJsonFile(leadsFilePath, leadData);
            await sendSuccessEmail({ ...parsedArgs, callerId: this.callerId });
            result = { status: 'success', message: 'Appointment scheduled successfully.' };
        }
      } else if (name === 'report_interaction') {
        const interactionData = {
             timestamp: new Date().toISOString(),
             callerId: this.callerId,
             mode: this.mode,
             ...parsedArgs
        };
        appendToJsonFile(interactionsFilePath, interactionData);
        await sendReportEmail({ ...parsedArgs, callerId: this.callerId });
        result = { status: 'success', message: 'Interaction logged.' };
      } else if (name === 'end_call') {
        result = { status: 'ending' };
        // 10 second delay before closing socket
        setTimeout(() => {
            logger.info(`Executing delayed socket close for call ${this.callSid}`);
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.close();
            }
            if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
                this.openaiWs.close();
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

      // Trigger a response generation so it can verbally confirm (or say goodbye)
      this.sendToOpenAI({ type: 'response.create' });

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
      // Also update callSid just in case
      this.callSid = data.start.callSid;
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
