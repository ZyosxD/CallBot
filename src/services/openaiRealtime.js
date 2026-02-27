import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LEADS_FILE = path.join(__dirname, '../data/leads.json');
const INTERACTIONS_FILE = path.join(__dirname, '../data/interactions.json');

export class OpenAIRealtimeService {
  constructor(ws, callSid) {
    this.ws = ws;
    this.callSid = callSid;
    this.callerId = 'Unknown'; // Initialize callerId
    this.openaiWs = null;
    this.streamSid = null;
    this.sessionConfig = {
      voice: 'coral',
      instructions: prompts.systemInstruction,
    };
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
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 1500
        },
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        voice: this.sessionConfig.voice,
        instructions: this.sessionConfig.instructions,
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Schedule a technical assessment after collecting all required details.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the IT Manager or Owner" },
                companyName: { type: "string", description: "Name of the company" },
                verifiedPhone: { type: "string", description: "The best phone number to call back" },
                appointmentTime: { type: "string", description: "The agreed date and time for the call" },
                notes: { type: "string", description: "Any additional notes about pain points or needs" }
              },
              required: ["contactName", "companyName", "verifiedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report the outcome of the call if no appointment was scheduled.",
            parameters: {
              type: "object",
              properties: {
                result: {
                    type: "string",
                    enum: ["not_interested", "call_later", "voicemail", "gatekeeper_block"],
                    description: "The outcome of the interaction"
                },
                notes: { type: "string", description: "Details about why they were not interested or when to call back" }
              },
              required: ["result"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the conversation politely.",
            parameters: {
              type: "object",
              properties: {
                  message: { type: "string", description: "The farewell message to speak before hanging up." }
              },
              required: ["message"]
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
      const event = JSON.parse(data.toString());

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

    logger.info(`Function call detected: ${name}`);
    let result = { success: true };

    try {
      if (name === 'schedule_appointment') {
        this.saveLead(parsedArgs);
        // Use this.callerId (phone number) instead of callSid
        await sendSuccessEmail({ ...parsedArgs, callerId: this.callerId });
      } else if (name === 'report_interaction') {
        this.saveInteraction(parsedArgs);
        await sendReportEmail({ ...parsedArgs, callerId: this.callerId });
      } else if (name === 'end_call') {
        // Send the farewell message first (usually OpenAI generates audio for the response)
        // Then wait and close.
        setTimeout(() => {
            if (this.ws) this.ws.close();
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

      // Trigger a response generation
      this.sendToOpenAI({ type: 'response.create' });

    } catch (error) {
      logger.error(`Error executing function ${name}:`, error);
    }
  }

  saveLead(data) {
      try {
          const leads = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8'));
          leads.push({ ...data, timestamp: new Date().toISOString() });
          fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
      } catch (err) {
          logger.error('Error saving lead:', err);
      }
  }

  saveInteraction(data) {
      try {
          const interactions = JSON.parse(fs.readFileSync(INTERACTIONS_FILE, 'utf8'));
          interactions.push({ ...data, timestamp: new Date().toISOString() });
          fs.writeFileSync(INTERACTIONS_FILE, JSON.stringify(interactions, null, 2));
      } catch (err) {
          logger.error('Error saving interaction:', err);
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
      if(data.start.callSid) this.callSid = data.start.callSid;

      // Extract callerId from custom parameters
      if (data.start.customParameters && data.start.customParameters.callerId) {
          this.callerId = data.start.customParameters.callerId;
          logger.info(`Set session CallerID to: ${this.callerId}`);
      }

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
