import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const leadsFilePath = path.join(__dirname, '../data/leads.json');
const interactionsFilePath = path.join(__dirname, '../data/interactions.json');

export class OpenAIRealtimeService {
  constructor(ws, callSid, callerId, mode) {
    this.ws = ws;
    this.callSid = callSid;
    this.callerId = callerId;
    this.mode = mode;
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
          instructions: prompts.greeting
        }
      });
    }
  }

  sendSessionUpdate() {
    const instructions = this.mode === 'inbound' ? prompts.SARAH_INBOUND : prompts.SARAH_OUTBOUND;

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
        instructions: instructions,
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Schedule a technical assessment",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the IT Manager or Owner" },
                companyName: { type: "string", description: "Name of the company" },
                confirmedPhone: { type: "string", description: "The verbally confirmed phone number" },
                appointmentTime: { type: "string", description: "Exact time for the assessment tomorrow" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report the outcome of the interaction when no appointment is made",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Reason for not scheduling (e.g., Not interested, call later, voicemail)" },
                summary: { type: "string", description: "Brief summary of the conversation" }
              },
              required: ["reason", "summary"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call gracefully at the conclusion of the conversation",
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
    const { name, arguments: argsStr, call_id: callId } = event;
    logger.info(`Function call detected: ${name} with args: ${argsStr}`);

    let parsedArgs = {};
    try {
      parsedArgs = JSON.parse(argsStr);
    } catch (error) {
      logger.error(`Error parsing function arguments: ${argsStr}`);
    }

    let result = null;

    try {
      if (name === 'schedule_appointment') {
        const { contactName, companyName, confirmedPhone, appointmentTime } = parsedArgs;

        // Save to leads.json
        try {
          const leads = JSON.parse(fs.readFileSync(leadsFilePath, 'utf8') || '[]');
          leads.push({
            callSid: this.callSid,
            callerId: this.callerId,
            contactName,
            companyName,
            confirmedPhone,
            appointmentTime,
            timestamp: new Date().toISOString()
          });
          fs.writeFileSync(leadsFilePath, JSON.stringify(leads, null, 2));
        } catch (err) {
          logger.error('Error saving lead:', err);
        }

        // Send Success Email
        await sendSuccessEmail(contactName, companyName, confirmedPhone, this.callerId, appointmentTime);
        result = { status: "Success", message: "Appointment scheduled" };

      } else if (name === 'report_interaction') {
        const { reason, summary } = parsedArgs;

        // Save to interactions.json
        try {
          const interactions = JSON.parse(fs.readFileSync(interactionsFilePath, 'utf8') || '[]');
          interactions.push({
            callSid: this.callSid,
            callerId: this.callerId,
            reason,
            summary,
            timestamp: new Date().toISOString()
          });
          fs.writeFileSync(interactionsFilePath, JSON.stringify(interactions, null, 2));
        } catch (err) {
          logger.error('Error saving interaction:', err);
        }

        // Send Report Email
        await sendReportEmail(reason, this.callerId, summary);
        result = { status: "Success", message: "Interaction reported" };

      } else if (name === 'end_call') {
        result = { status: "Success", message: "Ending call in 10 seconds" };

        // Instruct OpenAI to say goodbye
        this.sendToOpenAI({
          type: 'response.create',
          response: {
            instructions: "Say a short, polite goodbye."
          }
        });

        // Delay closing socket by 10 seconds
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

      // Trigger a response generation if not ending the call
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

      if (data.start.customParameters) {
        this.callerId = data.start.customParameters.callerId || this.callerId;
        this.mode = data.start.customParameters.mode || this.mode;
      }

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
