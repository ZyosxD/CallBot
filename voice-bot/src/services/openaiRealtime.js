import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import twilio from 'twilio';
import fs from 'fs';
import path from 'path';
import { sendReportEmail } from './emailService.js';

export class OpenAIRealtimeService {
  constructor(ws, callSid, mode = 'inbound', callerId = 'unknown') {
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
        this.isOpenAiConnected = false;
      });

    } catch (error) {
      logger.error('Error connecting to OpenAI:', error);
    }
  }

  checkAndInitializeSession() {
    if (this.isOpenAiConnected && this.isTwilioStarted) {
      this.sendSessionUpdate();

      if (this.mode === 'outbound') {
        setTimeout(() => {
          this.sendToOpenAI({
            type: 'response.create',
            response: {
              instructions: "Start the conversation immediately: 'Hi! Um, do you handle the technology, or should I ask for an Office Manager?'"
            }
          });
        }, 500);
      } else {
         setTimeout(() => {
          this.sendToOpenAI({
            type: 'response.create',
            response: {
              instructions: "Start the conversation: 'Thank you for calling 1Wire. Do you handle the technology, or should I ask for an Office Manager?'"
            }
          });
        }, 500);
      }
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
            description: "Schedule a technical assessment after getting the Trifecta (Contact Name, Company Name, Confirmed Phone, Exact Time).",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Who to ask for" },
                companyName: { type: "string", description: "Name of the company" },
                confirmedPhone: { type: "string", description: "The confirmed phone number to call back" },
                appointmentTime: { type: "string", description: "Exact time for tomorrow" },
                notes: { type: "string", description: "Any additional notes" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Log interaction if client is not interested, asks to call back later, or reaches voicemail.",
            parameters: {
              type: "object",
              properties: {
                outcome: { type: "string", description: "Why it didn't result in an appointment (e.g., Not interested, Voicemail, Call later)" },
                notes: { type: "string", description: "Any additional notes" }
              },
              required: ["outcome"]
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
    const { name, arguments: args, call_id } = event;
    logger.info(`Function call detected: ${name} with args: ${args}`);

    let parsedArgs = {};
    try {
      parsedArgs = JSON.parse(args);
    } catch (e) {
      logger.error('Error parsing function arguments:', e);
      return;
    }

    let result = null;

    try {
      if (name === 'schedule_appointment') {
        const leadsFile = path.resolve('src/data/leads.json');
        const leads = JSON.parse(fs.readFileSync(leadsFile, 'utf8'));
        leads.push({ timestamp: new Date().toISOString(), phone: this.callerId, ...parsedArgs });
        fs.writeFileSync(leadsFile, JSON.stringify(leads, null, 2));

        await sendReportEmail('SUCCESS', this.callerId, parsedArgs.confirmedPhone, parsedArgs);
        result = { success: true, message: 'Appointment scheduled successfully.' };

      } else if (name === 'report_interaction') {
        const interactionsFile = path.resolve('src/data/interactions.json');
        const interactions = JSON.parse(fs.readFileSync(interactionsFile, 'utf8'));
        interactions.push({ timestamp: new Date().toISOString(), phone: this.callerId, ...parsedArgs });
        fs.writeFileSync(interactionsFile, JSON.stringify(interactions, null, 2));

        await sendReportEmail('REPORT', this.callerId, 'N/A', parsedArgs);
        result = { success: true, message: 'Interaction reported.' };

      } else if (name === 'end_call') {
        result = { success: true, message: 'Call ending in 10 seconds.' };

        // Output function result immediately
        const functionOutput = {
          type: 'conversation.item.create',
          item: { type: 'function_call_output', call_id: call_id, output: JSON.stringify(result) }
        };
        this.sendToOpenAI(functionOutput);

        // Final goodbye before closing
        this.sendToOpenAI({
          type: 'response.create',
          response: { instructions: "Say a short, polite goodbye." }
        });

        // 10 second delay before closing socket
        setTimeout(() => {
          logger.info(`Closing WebSocket for call ${this.callSid} after end_call delay.`);
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.close();
          }
        }, 10000);
        return; // Early return to prevent normal function_call_output below
      }

      const functionOutput = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: call_id,
          output: JSON.stringify(result)
        }
      };
      this.sendToOpenAI(functionOutput);
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
      logger.info(`Stream started: ${this.streamSid}`);

      // Extract custom parameters if available
      if (data.start.customParameters) {
        if (data.start.customParameters.mode) {
          this.mode = data.start.customParameters.mode;
        }
        if (data.start.customParameters.callerId) {
          this.callerId = data.start.customParameters.callerId;
        }
      }

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
