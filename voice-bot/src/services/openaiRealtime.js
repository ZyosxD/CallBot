import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import twilio from 'twilio';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class OpenAIRealtimeService {
  constructor(ws, callSid) {
    this.ws = ws;
    this.callSid = callSid;
    this.callerId = 'unknown';
    this.mode = 'SARAH_INBOUND';
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
    const systemInstruction = this.mode === 'SARAH_OUTBOUND' ? prompts.SARAH_OUTBOUND : prompts.SARAH_INBOUND;

    const sessionUpdate = {
      type: 'session.update',
      session: {
        turn_detection: { type: 'server_vad', silence_duration_ms: 1500 },
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
            description: "Schedule a technical assessment after getting The Trifecta + Time from the user.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "The name of the contact (e.g., IT Manager or Owner)" },
                companyName: { type: "string", description: "The name of the company" },
                confirmedPhone: { type: "string", description: "The verified phone number to call" },
                appointmentTime: { type: "string", description: "The agreed upon time for the call (e.g., 'Tomorrow at 2pm')" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report when a user is not interested, wants to be called later, or if you reached a voicemail.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Reason for the report (e.g., 'Not interested', 'Call back later', 'Voicemail')" },
                notes: { type: "string", description: "Any additional notes about the interaction" }
              },
              required: ["reason"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call after the conversation is completely finished and you have said goodbye.",
            parameters: {
              type: "object",
              properties: {},
              required: []
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
        const lead = {
          callSid: this.callSid,
          callerId: this.callerId,
          ...parsedArgs,
          timestamp: new Date().toISOString()
        };

        const leadsPath = path.join(__dirname, '../data/leads.json');
        let leads = [];
        if (fs.existsSync(leadsPath)) {
          leads = JSON.parse(fs.readFileSync(leadsPath, 'utf8'));
        }
        leads.push(lead);
        fs.writeFileSync(leadsPath, JSON.stringify(leads, null, 2));

        import('./emailService.js').then(({ sendSuccessEmail }) => {
            sendSuccessEmail(lead);
        }).catch(err => logger.error("Failed to load emailService.js", err));

        result = { success: true, message: "Appointment scheduled and email sent." };
      } else if (name === 'report_interaction') {
        const interaction = {
          callSid: this.callSid,
          callerId: this.callerId,
          ...parsedArgs,
          timestamp: new Date().toISOString()
        };

        const interactionsPath = path.join(__dirname, '../data/interactions.json');
        let interactions = [];
        if (fs.existsSync(interactionsPath)) {
          interactions = JSON.parse(fs.readFileSync(interactionsPath, 'utf8'));
        }
        interactions.push(interaction);
        fs.writeFileSync(interactionsPath, JSON.stringify(interactions, null, 2));

        import('./emailService.js').then(({ sendReportEmail }) => {
            sendReportEmail(interaction);
        }).catch(err => logger.error("Failed to load emailService.js", err));

        result = { success: true, message: "Interaction reported and email sent." };
      } else if (name === 'end_call') {
        result = { status: 'ending_call' };
        setTimeout(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
              this.ws.close();
          }
          if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
              this.openaiWs.close();
          }
        }, 10000); // 10 second delay before closing socket
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

      // Trigger a response generation if it's not ending the call
      if (name !== 'end_call') {
          this.sendToOpenAI({ type: 'response.create' });
      }

    } catch (error) {
      logger.error(`Error executing function ${name}:`, error);
      // Optionally send error back
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

      if (data.start.customParameters) {
        if (data.start.customParameters.mode) {
          this.mode = data.start.customParameters.mode;
        }
        if (data.start.customParameters.callerId) {
          this.callerId = data.start.customParameters.callerId;
        }
      }

      logger.info(`Stream started: ${this.streamSid}, mode: ${this.mode}, callerId: ${this.callerId}`);

      // Re-send session update with new mode
      this.sendSessionUpdate();

      // Ensure the AI speaks first by sending a response.create event
      this.sendToOpenAI({
        type: 'response.create',
        response: {
          instructions: 'Start the conversation immediately with your greeting.'
        }
      });
    } else if (data.event === 'media') {
        const audioAppend = {
            type: 'input_audio_buffer.append',
            audio: data.media.payload
        };
        this.sendToOpenAI(audioAppend);
    }
  }
}
