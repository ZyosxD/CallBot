import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';
import twilio from 'twilio';

const leadsFile = path.resolve('src/data/leads.json');
const interactionsFile = path.resolve('src/data/interactions.json');

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
      logger.info('Both OpenAI and Twilio are ready. Initializing session...');
      this.sendSessionUpdate();
      // Start the conversation immediately
      this.sendToOpenAI({
        type: 'response.create',
        response: {
          instructions: 'Start the conversation immediately with a polite greeting.'
        }
      });
    }
  }

  sendSessionUpdate() {
    const instructions = this.mode === 'outbound' ? prompts.SARAH_OUTBOUND : prompts.SARAH_INBOUND;
    const sessionUpdate = {
      type: 'session.update',
      session: {
        turn_detection: { type: 'server_vad', silence_duration_ms: 1500 },
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        voice: 'coral',
        instructions: instructions,
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Schedule a technical assessment when the client agrees. You MUST collect contactName, companyName, confirmedPhone, and appointmentTime before calling this.",
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
            description: "Report the interaction if the client is not interested, asks to call back later, or if you reach voicemail.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string" },
                transcriptSummary: { type: "string" }
              },
              required: ["reason", "transcriptSummary"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call and close the connection.",
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

    logger.info(`Function call detected: ${name} with args: ${args}`);
    let result = null;

    try {
      parsedArgs = JSON.parse(args);
    } catch (error) {
      logger.error(`Error parsing JSON arguments for tool ${name}:`, error);
      parsedArgs = {}; // Fallback
    }

    try {
      if (name === 'schedule_appointment') {
        let leads = [];
        try {
          leads = JSON.parse(fs.readFileSync(leadsFile, 'utf-8'));
        } catch (e) { }

        const appointmentData = {
          ...parsedArgs,
          originalPhone: this.callerId,
          timestamp: new Date().toISOString()
        };
        leads.push(appointmentData);
        fs.writeFileSync(leadsFile, JSON.stringify(leads, null, 2));

        await sendSuccessEmail(appointmentData);
        result = { status: 'success' };

      } else if (name === 'report_interaction') {
        let interactions = [];
        try {
          interactions = JSON.parse(fs.readFileSync(interactionsFile, 'utf-8'));
        } catch (e) { }

        const interactionData = {
          ...parsedArgs,
          originalPhone: this.callerId,
          transcript: parsedArgs.transcriptSummary || 'N/A',
          timestamp: new Date().toISOString()
        };
        interactions.push(interactionData);
        fs.writeFileSync(interactionsFile, JSON.stringify(interactions, null, 2));

        await sendReportEmail(interactionData);
        result = { status: 'reported' };

      } else if (name === 'end_call') {
        logger.info(`Ending call ${this.callSid} in 10 seconds.`);

        this.sendToOpenAI({
          type: 'response.create',
          response: {
            instructions: 'Say a short, polite goodbye right now.'
          }
        });

        setTimeout(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.close();
          }
        }, 10000);

        result = { status: 'ending' };
      }

      // Send result back to OpenAI to resolve the tool call
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
      // Send fallback result to prevent hanging
      this.sendToOpenAI({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify({ error: 'Tool execution failed' })
        }
      });
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
      this.callSid = data.start.callSid; // explicitly update callSid as per memory
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
