import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';
import fs from 'fs';
import path from 'path';

const leadsFile = path.resolve('src/data/leads.json');
const interactionsFile = path.resolve('src/data/interactions.json');

export class OpenAIRealtimeService {
  constructor(ws, callSid, callerId, mode) {
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
        // Will be called from callController when both sides are ready
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
    let modeInstruction = this.mode === 'outbound'
      ? "\nYou are calling a potential client (outbound). Start the conversation immediately according to the script."
      : "\nA potential client has called you (inbound receptionist). Answer their call enthusiastically and guide them to a Technical Assessment.";

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
        instructions: prompts.systemInstruction + modeInstruction,
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Schedule a Technical Assessment. Only trigger when you have the Trifecta (Contact Name, Company Name, Confirmed Phone, Appointment Time).",
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
            description: "Log an interaction if the client is not interested, asks to call back later, or you reach a voicemail.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Reason for reporting (e.g., Not interested, Voicemail, Call back later)" },
                details: { type: "string", description: "Any extra details gathered" }
              },
              required: ["reason"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the current call after you have said goodbye.",
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

    try {
        parsedArgs = JSON.parse(args);
    } catch (e) {
        logger.error(`Error parsing args for tool ${name}: ${args}`);
    }

    logger.info(`Function call detected: ${name} with args: ${args}`);
    let result = null;

    try {
      if (name === 'schedule_appointment') {
        const lead = { ...parsedArgs, callerId: this.callerId, callSid: this.callSid, timestamp: new Date().toISOString() };
        let leads = [];
        if (fs.existsSync(leadsFile)) {
           leads = JSON.parse(fs.readFileSync(leadsFile, 'utf8'));
        }
        leads.push(lead);
        fs.writeFileSync(leadsFile, JSON.stringify(leads, null, 2));

        await sendSuccessEmail(lead, this.callerId, parsedArgs.confirmedPhone);
        result = { status: 'success', message: 'Appointment scheduled and email sent.' };

      } else if (name === 'report_interaction') {
        const interaction = { ...parsedArgs, callerId: this.callerId, callSid: this.callSid, timestamp: new Date().toISOString() };
        let interactions = [];
        if (fs.existsSync(interactionsFile)) {
           interactions = JSON.parse(fs.readFileSync(interactionsFile, 'utf8'));
        }
        interactions.push(interaction);
        fs.writeFileSync(interactionsFile, JSON.stringify(interactions, null, 2));

        await sendReportEmail(interaction, this.callerId, parsedArgs.reason);
        result = { status: 'reported' };

      } else if (name === 'end_call') {
         result = { status: 'ending_call' };
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

      if (name === 'end_call') {
          // Send a final response to say goodbye then wait 10s
          this.sendToOpenAI({ type: 'response.create' });

          setTimeout(() => {
              logger.info(`Ending call for Sid ${this.callSid} after 10s delay`);
              if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                  this.ws.close();
              }
              if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
                  this.openaiWs.close();
              }
          }, 10000);
      } else {
         // Trigger a response generation for other tools
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
