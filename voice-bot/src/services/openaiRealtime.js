import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendReportEmail } from './emailService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
    const promptInstructions = this.mode === 'outbound' ? prompts.SARAH_OUTBOUND : prompts.SARAH_INBOUND;

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
        instructions: promptInstructions,
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Schedule a technical assessment after collecting The Trifecta (Contact Name, Company Name, Verified Phone, Appointment Time). DO NOT call this tool without gathering all four pieces of information.",
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
            description: "Record the details of an interaction when the user is not interested, requests a callback later, or if the call goes to voicemail.",
            parameters: {
              type: "object",
              properties: {
                summary: { type: "string", description: "Brief summary of what happened." },
                callbackRequested: { type: "boolean" }
              },
              required: ["summary", "callbackRequested"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call after a successful interaction or when the user says goodbye.",
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

    // Initial greeting trigger immediately to start speaking
    this.sendToOpenAI({
        type: 'response.create',
        response: {
            instructions: "Start the conversation immediately. Say the greeting per your instructions without waiting."
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
    const { name, arguments: args } = event;
    const parsedArgs = JSON.parse(args);
    const callId = event.call_id;

    logger.info(`Function call detected: ${name} with args: ${args}`);
    let result = null;

    try {
      if (name === 'schedule_appointment') {
        const lead = {
          id: Date.now(),
          originalCallerId: this.callerId,
          ...parsedArgs
        };

        const leadsPath = path.join(__dirname, '../data/leads.json');
        let leads = [];
        if (fs.existsSync(leadsPath)) {
           leads = JSON.parse(fs.readFileSync(leadsPath, 'utf-8'));
        }
        leads.push(lead);
        fs.writeFileSync(leadsPath, JSON.stringify(leads, null, 2));

        sendReportEmail('SUCCESS', lead);
        result = { success: true, message: "Appointment Scheduled successfully." };

      } else if (name === 'report_interaction') {
        const interaction = {
            id: Date.now(),
            originalCallerId: this.callerId,
            ...parsedArgs
        };

        const interactionsPath = path.join(__dirname, '../data/interactions.json');
        let interactions = [];
        if (fs.existsSync(interactionsPath)) {
            interactions = JSON.parse(fs.readFileSync(interactionsPath, 'utf-8'));
        }
        interactions.push(interaction);
        fs.writeFileSync(interactionsPath, JSON.stringify(interactions, null, 2));

        sendReportEmail('REPORT', interaction);
        result = { success: true, message: "Interaction logged." };

      } else if (name === 'end_call') {
        result = { success: true, message: "Ending call in 10 seconds." };
        setTimeout(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.close();
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

      if (name !== 'end_call') {
          // Trigger a response generation after standard tools
          this.sendToOpenAI({ type: 'response.create' });
      } else {
          // Say a final goodbye before waiting 10 seconds to close
          this.sendToOpenAI({
              type: 'response.create',
              response: {
                  instructions: "Say a short, polite goodbye to the user right now."
              }
          });
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
