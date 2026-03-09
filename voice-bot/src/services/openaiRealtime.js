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
const leadsFilePath = path.join(__dirname, '../data/leads.json');
const interactionsFilePath = path.join(__dirname, '../data/interactions.json');

const saveData = (filePath, data) => {
    try {
        let currentData = [];
        if (fs.existsSync(filePath)) {
            const fileContent = fs.readFileSync(filePath, 'utf8');
            currentData = JSON.parse(fileContent);
        }
        currentData.push(data);
        fs.writeFileSync(filePath, JSON.stringify(currentData, null, 2), 'utf8');
    } catch (error) {
        logger.error(`Error saving data to ${filePath}:`, error);
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
        logger.info('Connected to OpenAI Realtime API');
        this.sendSessionUpdate();

        // Immediate response creation to ensure AI speaks first
        const initialGreeting = this.mode === 'outbound'
            ? "Start the conversation immediately as a cold caller."
            : "Greet the caller warmly as a receptionist.";

        this.sendToOpenAI({
            type: 'response.create',
            response: {
                instructions: initialGreeting
            }
        });
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
    const instructions = this.mode === 'outbound' ? prompts.SARAH_OUTBOUND : prompts.SARAH_INBOUND;

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
            description: "Schedule an appointment. This MUST ONLY be called if you have collected all of: contactName, companyName, confirmedPhone, and appointmentTime.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the person." },
                companyName: { type: "string", description: "Name of the company." },
                confirmedPhone: { type: "string", description: "The confirmed phone number to reach them." },
                appointmentTime: { type: "string", description: "The exact date/time agreed upon." }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report the interaction outcome when the client is not interested, asks to call back, or reaches voicemail.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Reason for the report (e.g., 'Not interested', 'Call back later', 'Voicemail')." },
                notes: { type: "string", description: "Additional details about the conversation." },
                confirmedPhone: { type: "string", description: "If a phone number was confirmed, include it here." }
              },
              required: ["reason"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call after a proper farewell.",
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
    const parsedArgs = JSON.parse(args);
    const callId = event.call_id;

    logger.info(`Function call detected: ${name} with args: ${args}`);
    let result = null;

    try {
      if (name === 'schedule_appointment') {
        const leadData = {
            id: Date.now(),
            callSid: this.callSid,
            twilioCallerId: this.callerId,
            ...parsedArgs
        };
        saveData(leadsFilePath, leadData);

        await sendReportEmail({
            type: 'SUCCESS',
            callerId: this.callerId,
            confirmedPhone: parsedArgs.confirmedPhone,
            details: leadData
        });

        result = { success: true, message: 'Appointment scheduled successfully.' };
      } else if (name === 'report_interaction') {
        const interactionData = {
            id: Date.now(),
            callSid: this.callSid,
            twilioCallerId: this.callerId,
            ...parsedArgs
        };
        saveData(interactionsFilePath, interactionData);

        await sendReportEmail({
            type: 'REPORT',
            callerId: this.callerId,
            confirmedPhone: parsedArgs.confirmedPhone || 'N/A',
            details: interactionData
        });

        result = { success: true, message: 'Interaction reported.' };
      } else if (name === 'end_call') {
        // Handle end call logic
        logger.info(`End call requested by AI for ${this.callSid}. Closing socket in 10s...`);

        // Wait 10 seconds to allow for farewell audio to finish
        setTimeout(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.close();
            }
            if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
                this.openaiWs.close();
            }
            logger.info(`Closed connection for ${this.callSid}`);
        }, 10000);

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

      // Only trigger response creation if not ending call, otherwise let it finish its turn
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
