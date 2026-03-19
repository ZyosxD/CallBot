import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendReportEmail } from './emailService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const appendToJsonArray = (filePath, data) => {
  try {
    const file = path.join(__dirname, filePath);
    let items = [];
    if (fs.existsSync(file)) {
      items = JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    items.push(data);
    fs.writeFileSync(file, JSON.stringify(items, null, 2));
  } catch (err) {
    logger.error(`Error saving to ${filePath}:`, err);
  }
};

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
        logger.info(`Connected to OpenAI Realtime API for call ${this.callSid}`);
        this.sendSessionUpdate();

        // Force the AI to speak first
        this.sendToOpenAI({
          type: 'response.create',
          response: {
            instructions: "Start the conversation immediately by greeting the user following the script."
          }
        });
      });

      this.openaiWs.on('message', (data) => {
        this.handleOpenAIMessage(data);
      });

      this.openaiWs.on('error', (error) => {
        logger.error(`OpenAI WebSocket Error for call ${this.callSid}:`, error);
      });

      this.openaiWs.on('close', () => {
        logger.info(`OpenAI WebSocket Closed for call ${this.callSid}`);
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
            description: "Schedule a Technical Assessment when the client agrees. You MUST collect the Contact Name, Company Name, Confirmed Phone Number, and Appointment Time.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the manager or owner" },
                companyName: { type: "string", description: "Company name" },
                confirmedPhone: { type: "string", description: "Verbally confirmed phone number" },
                appointmentTime: { type: "string", description: "Date and time for the assessment" },
                notes: { type: "string", description: "Extra notes from the conversation" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report the call outcome if the user is not interested, went to voicemail, or asked to call back later.",
            parameters: {
              type: "object",
              properties: {
                companyName: { type: "string", description: "Company name if provided" },
                contactName: { type: "string", description: "Contact name if provided" },
                reason: { type: "string", description: "Reason for rejection or outcome (e.g., voicemail, not interested)" }
              },
              required: ["reason"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the current conversation. Say a polite goodbye before triggering this tool.",
            parameters: {
              type: "object",
              properties: {}
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
        const leadData = {
          callSid: this.callSid,
          originalPhone: this.callerId,
          ...parsedArgs,
          timestamp: new Date().toISOString()
        };

        appendToJsonArray('../data/leads.json', leadData);
        await sendReportEmail('SUCCESS', leadData);
        result = { status: 'Appointment scheduled successfully. You can end the call now.' };

      } else if (name === 'report_interaction') {
        const interactionData = {
          callSid: this.callSid,
          originalPhone: this.callerId,
          ...parsedArgs,
          timestamp: new Date().toISOString()
        };

        appendToJsonArray('../data/interactions.json', interactionData);
        await sendReportEmail('REPORT', {
           contactName: parsedArgs.contactName,
           companyName: parsedArgs.companyName,
           originalPhone: this.callerId,
           confirmedPhone: "N/A",
           notes: `Outcome: ${parsedArgs.reason}`
        });
        result = { status: 'Interaction logged. You can end the call now.' };

      } else if (name === 'end_call') {
        logger.info(`Triggering end call in 10s for ${this.callSid}`);
        result = { status: 'Call is ending.' };

        // Let the AI say goodbye
        this.sendToOpenAI({
          type: 'response.create',
          response: {
            instructions: "Say a short polite goodbye before the call disconnects."
          }
        });

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
        // Trigger a response generation so it confirms completion
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
      // Overwrite callSid here just in case, but keep callerId we fetched
      this.callSid = data.start.callSid;
      this.streamSid = data.start.streamSid;
      logger.info(`Stream started: ${this.streamSid} for Call: ${this.callSid}`);
    } else if (data.event === 'media') {
        const audioAppend = {
            type: 'input_audio_buffer.append',
            audio: data.media.payload
        };
        this.sendToOpenAI(audioAppend);
    }
  }
}
