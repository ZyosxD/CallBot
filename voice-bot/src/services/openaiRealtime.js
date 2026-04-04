import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';
import twilio from 'twilio';

const leadsPath = path.resolve('src/data/leads.json');
const interactionsPath = path.resolve('src/data/interactions.json');

const appendToJson = (filePath, data) => {
    let currentData = [];
    if (fs.existsSync(filePath)) {
        currentData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
    currentData.push(data);
    fs.writeFileSync(filePath, JSON.stringify(currentData, null, 2), 'utf-8');
};

export class OpenAIRealtimeService {
  constructor(ws, callSid) {
    this.ws = ws;
    this.callSid = callSid;
    this.openaiWs = null;
    this.streamSid = null;
    this.mode = 'inbound';
    this.callerId = 'unknown';
    this.isOpenAiConnected = false;
    this.isTwilioStarted = false;
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
      if (this.isOpenAiConnected && this.isTwilioStarted) {
          this.sendSessionUpdate();
      }
  }

  sendSessionUpdate() {
    const systemInstruction = this.mode === 'outbound' ? prompts.SARAH_OUTBOUND : prompts.SARAH_INBOUND;

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
            description: "Schedule a Technical Assessment for a client when they agree and provide The Trifecta details.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the person" },
                companyName: { type: "string", description: "Name of the company" },
                confirmedPhone: { type: "string", description: "The confirmed phone number to call back" },
                appointmentTime: { type: "string", description: "The exact date and time for the appointment" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Log the interaction when the client is not interested, asks to call back later, or if the call reached voicemail.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Reason for the report (e.g., 'not interested', 'voicemail')" }
              },
              required: ["reason"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call conversation gracefully. Call this tool when the conversation is completely finished.",
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

    // Start conversation automatically if outbound
    if (this.mode === 'outbound') {
        this.sendToOpenAI({
            type: 'response.create',
            response: {
                instructions: "Start the conversation immediately by navigating the gatekeeper: '¿Manejas tú la tecnología o pregunto por un Office Manager?'"
            }
        });
    } else {
        this.sendToOpenAI({
            type: 'response.create',
            response: {
                instructions: "Start the conversation immediately by greeting them warmly as the receptionist for 1Wire, and ask how you can help."
            }
        });
    }
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
    const callId = event.call_id;

    logger.info(`Function call detected: ${name} with args: ${args}`);

    let parsedArgs = {};
    try {
        parsedArgs = JSON.parse(args);
    } catch (err) {
        logger.error(`Error parsing args for ${name}`, err);
    }

    let result = null;

    try {
      if (name === 'schedule_appointment') {
        const leadData = {
            ...parsedArgs,
            originalCallerId: this.callerId,
            callSid: this.callSid,
            timestamp: new Date().toISOString()
        };
        appendToJson(leadsPath, leadData);
        await sendSuccessEmail(parsedArgs, this.callerId);
        result = { status: 'appointment_scheduled' };
      } else if (name === 'report_interaction') {
        const interactionData = {
            reason: parsedArgs.reason,
            originalCallerId: this.callerId,
            callSid: this.callSid,
            timestamp: new Date().toISOString()
        };
        appendToJson(interactionsPath, interactionData);
        await sendReportEmail(parsedArgs.reason, this.callerId);
        result = { status: 'interaction_reported' };
      } else if (name === 'end_call') {
        logger.info(`End call tool called for ${this.callSid}. Waiting 10s before closing socket.`);
        result = { status: 'ending_call' };

        // Final goodbye response before closing
        this.sendToOpenAI({
            type: 'response.create',
            response: {
                instructions: "Say a short, polite goodbye."
            }
        });

        setTimeout(() => {
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

      // Do not trigger another response.create if we are ending the call
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
