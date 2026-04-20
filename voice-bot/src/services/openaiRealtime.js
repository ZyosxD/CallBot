import WebSocket from 'ws';
import { config } from '../config/config.js';
import { SARAH_INBOUND, SARAH_OUTBOUND } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import twilio from 'twilio';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';
import fs from 'fs';
import path from 'path';

const leadsFile = path.resolve('src/data/leads.json');
const interactionsFile = path.resolve('src/data/interactions.json');

const appendToJsonFile = (filePath, data) => {
  try {
    let currentData = [];
    if (fs.existsSync(filePath)) {
      currentData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
    currentData.push(data);
    fs.writeFileSync(filePath, JSON.stringify(currentData, null, 2), 'utf8');
  } catch (error) {
    logger.error(`Error appending to ${filePath}:`, error);
  }
};

export class OpenAIRealtimeService {
  constructor(ws, callSid, mode, callerId) {
    this.ws = ws;
    this.callSid = callSid;
    this.mode = mode;
    this.callerId = callerId;
    this.openaiWs = null;
    this.streamSid = null;
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
      // Start the conversation immediately
      this.sendToOpenAI({
        type: 'response.create',
        response: {
          instructions: 'Start the conversation immediately with a greeting.',
        }
      });
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
        instructions: this.mode === 'inbound' ? SARAH_INBOUND : SARAH_OUTBOUND,
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Schedule a technical assessment after getting the trifecta.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string" },
                companyName: { type: "string" },
                confirmedPhone: { type: "string" },
                appointmentTime: { type: "string" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report an interaction if the client is not interested, asks to call back later, or it is a voicemail.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string" },
                notes: { type: "string" }
              },
              required: ["reason", "notes"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call gracefully after finishing the conversation.",
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
    const callId = event.call_id;
    let parsedArgs = {};
    let result = null;

    logger.info(`Function call detected: ${name} with args: ${args}`);

    try {
      parsedArgs = JSON.parse(args);
    } catch (error) {
      logger.error('SyntaxError parsing tool arguments:', error);
      // Still send function output to avoid hanging model
      this.sendFunctionOutput(callId, { error: 'Invalid JSON arguments' });
      return;
    }

    try {
      if (name === 'schedule_appointment') {
        const lead = {
          ...parsedArgs,
          callerId: this.callerId,
          callSid: this.callSid,
          timestamp: new Date().toISOString()
        };
        appendToJsonFile(leadsFile, lead);
        sendSuccessEmail(
          parsedArgs.contactName,
          parsedArgs.companyName,
          parsedArgs.confirmedPhone,
          parsedArgs.appointmentTime,
          this.callerId
        );
        result = { status: 'appointment_scheduled' };
      } else if (name === 'report_interaction') {
        const interaction = {
          ...parsedArgs,
          callerId: this.callerId,
          callSid: this.callSid,
          timestamp: new Date().toISOString()
        };
        appendToJsonFile(interactionsFile, interaction);
        sendReportEmail(parsedArgs.reason, parsedArgs.notes, this.callerId);
        result = { status: 'interaction_reported' };
      } else if (name === 'end_call') {
        result = { status: 'ending_call' };

        // Final response right before 10s wait
        this.sendToOpenAI({
          type: 'response.create',
          response: {
            instructions: 'Say a short, polite goodbye.'
          }
        });

        // Delay 10s before closing socket
        setTimeout(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.close();
          }
          if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
            this.openaiWs.close();
          }
        }, 10000);
      }

      this.sendFunctionOutput(callId, result);

      if (name !== 'end_call') {
        this.sendToOpenAI({ type: 'response.create' });
      }

    } catch (error) {
      logger.error(`Error executing function ${name}:`, error);
      this.sendFunctionOutput(callId, { error: 'Internal execution error' });
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
