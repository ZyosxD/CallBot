import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const leadsFilePath = path.join(__dirname, '../data/leads.json');
const interactionsFilePath = path.join(__dirname, '../data/interactions.json');

const appendToFile = (filePath, data) => {
  try {
    let currentData = [];
    if (fs.existsSync(filePath)) {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      if (fileContent) {
          currentData = JSON.parse(fileContent);
      }
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
    this.mode = mode || 'inbound';
    this.openaiWs = null;
    this.streamSid = null;
    this.isOpenAiConnected = false;
    this.isTwilioStarted = false;
    this.sessionUpdateSent = false;
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
        this.isOpenAiConnected = true;
        this.checkAndInitializeSession();
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

  checkAndInitializeSession() {
    if (this.isOpenAiConnected && this.isTwilioStarted && !this.sessionUpdateSent) {
      this.sendSessionUpdate();
      this.sessionUpdateSent = true;
    }
  }

  sendSessionUpdate() {
    const systemInstruction = this.mode === 'outbound' ? prompts.SARAH_OUTBOUND : prompts.SARAH_INBOUND;
    const initialGreeting = this.mode === 'outbound' ? prompts.greeting_outbound : prompts.greeting_inbound;

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
        instructions: systemInstruction,
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Schedule a technical assessment. Only call this when you have collected the Trifecta (Contact Name, Company Name, Confirmed Phone) and Exact Time.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the person handling technology" },
                companyName: { type: "string", description: "Name of the company" },
                confirmedPhone: { type: "string", description: "The verbally confirmed phone number" },
                appointmentTime: { type: "string", description: "The exact date and time for the appointment" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Log an interaction when the client is not interested, asks to call back later, or reaches a voicemail.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Reason for the report (e.g., Not interested, Call back later, Voicemail)" },
                notes: { type: "string", description: "Any additional notes about the interaction" }
              },
              required: ["reason"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call gracefully at the final of the conversation.",
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

    // Instruct AI to speak first
    const initialResponse = {
        type: 'response.create',
        response: {
            instructions: `Start the conversation immediately by saying exactly: "${initialGreeting}"`
        }
    };
    this.sendToOpenAI(initialResponse);
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
    const { name, arguments: args, call_id: callId } = event;
    logger.info(`Function call detected: ${name} with args: ${args}`);

    let parsedArgs = {};
    try {
        parsedArgs = JSON.parse(args);
    } catch (err) {
        logger.error(`Failed to parse arguments for ${name}: ${args}`);
    }

    let result = null;

    try {
      if (name === 'schedule_appointment') {
        const leadData = {
            ...parsedArgs,
            callerId: this.callerId,
            callSid: this.callSid,
            timestamp: new Date().toISOString()
        };
        appendToFile(leadsFilePath, leadData);
        await sendSuccessEmail(leadData);
        result = { success: true, message: 'Appointment scheduled and email sent.' };
      } else if (name === 'report_interaction') {
        const interactionData = {
            ...parsedArgs,
            callerId: this.callerId,
            callSid: this.callSid,
            timestamp: new Date().toISOString()
        };
        appendToFile(interactionsFilePath, interactionData);
        await sendReportEmail(interactionData);
        result = { success: true, message: 'Interaction logged and report email sent.' };
      } else if (name === 'end_call') {
        logger.info(`Initiating 10-second delay before ending call ${this.callSid}`);

        // Instruct to say goodbye before ending
        this.sendToOpenAI({
            type: 'response.create',
            response: {
                instructions: `Say exactly: "${prompts.goodbye}"`
            }
        });

        // Resolve function to prevent model hanging
        result = { success: true, status: 'ending_call' };
        this.sendFunctionOutput(callId, result);

        setTimeout(async () => {
             if (this.ws && (this.ws.readyState === 1)) { // WebSocket.OPEN is 1
                 // Dynamically import markCallEnded if needed to release lock
                 try {
                     const dripService = await import('./dripService.js');
                     dripService.releaseCallLock(this.callSid);
                 } catch (e) {
                     logger.error('Error releasing lock on end_call:', e);
                 }
                 this.ws.close();
             }
             if (this.openaiWs && (this.openaiWs.readyState === 1)) {
                 this.openaiWs.close();
             }
        }, 10000);
        return; // Early return because we already handled output
      }

      this.sendFunctionOutput(callId, result);

      if (name !== 'end_call') {
          this.sendToOpenAI({ type: 'response.create' });
      }

    } catch (error) {
      logger.error(`Error executing function ${name}:`, error);
      this.sendFunctionOutput(callId, { error: error.message });
    }
  }

  sendFunctionOutput(callId, result) {
      const functionOutput = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify(result)
        }
      };
      this.sendToOpenAI(functionOutput);
  }


  sendAudioToTwilio(audioPayload) {
    if (this.ws && (this.ws.readyState === 1) && this.streamSid) {
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
    if (this.openaiWs && (this.openaiWs.readyState === 1)) {
      this.openaiWs.send(JSON.stringify(data));
    }
  }

  handleTwilioMedia(data) {
    if (data.event === 'start') {
      this.streamSid = data.start.streamSid;
      this.callSid = data.start.callSid;
      logger.info(`Stream started: ${this.streamSid} for CallSid: ${this.callSid}`);
      this.isTwilioStarted = true;
      this.checkAndInitializeSession();
    } else if (data.event === 'media') {
        const audioAppend = {
            type: 'input_audio_buffer.append',
            audio: data.media.payload
        };
        this.sendToOpenAI(audioAppend);
    }
  }
}
