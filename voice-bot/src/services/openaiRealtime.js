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

const appendData = (filePath, data) => {
  try {
    let currentData = [];
    if (fs.existsSync(filePath)) {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      if (fileContent) {
        currentData = JSON.parse(fileContent);
      }
    }
    currentData.push(data);
    fs.writeFileSync(filePath, JSON.stringify(currentData, null, 2), 'utf8');
  } catch (error) {
    logger.error(`Error appending data to ${filePath}:`, error);
  }
};

export class OpenAIRealtimeService {
  constructor(ws, callSid, callerId, mode) {
    this.ws = ws;
    this.callSid = callSid;
    this.callerId = callerId;
    this.mode = mode; // 'inbound' or 'outbound'
    this.openaiWs = null;
    this.streamSid = null;
    this.endTimeout = null;
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
        logger.info(`Connected to OpenAI Realtime API for call ${this.callSid} (${this.mode})`);
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
    const systemPrompt = this.mode === 'outbound' ? prompts.SARAH_OUTBOUND : prompts.SARAH_INBOUND;

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
        instructions: systemPrompt,
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Schedule a Technical Assessment. Use ONLY when the user agrees to an assessment and you have collected all required information: Contact Name, Company Name, Confirmed Phone Number, and Appointment Time.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "The name of the IT Manager or Owner." },
                companyName: { type: "string", description: "The name of the company." },
                confirmedPhone: { type: "string", description: "The phone number verbally confirmed by the user." },
                appointmentTime: { type: "string", description: "The verbally confirmed exact time for the assessment." }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Log the interaction if the user is not interested, asks to call back later, or if it's a voicemail/gatekeeper block.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Short reason for the report (e.g., 'Not interested', 'Call back later', 'Voicemail')." },
                details: { type: "string", description: "Additional details about the conversation or request." }
              },
              required: ["reason", "details"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call gracefully. Use this tool at the very end of the conversation, after scheduling an appointment, reporting an interaction, or when the conversation naturally concludes. Say a short, polite goodbye immediately BEFORE calling this.",
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

    // Prompt the bot to start speaking immediately
    const greetingText = this.mode === 'outbound'
        ? "Hey! Are you the one handling the tech, or should I ask for an Office Manager?"
        : "Hi, thanks for calling 1Wire! Are you calling about your current service, or looking to upgrade your tech?";

    const startEvent = {
        type: 'response.create',
        response: {
            instructions: `Start the conversation immediately. Say exactly: "${greetingText}"`
        }
    };
    this.sendToOpenAI(startEvent);
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
        const leadData = {
            id: Date.now(),
            twilioCallerId: this.callerId,
            ...parsedArgs,
            createdAt: new Date().toISOString()
        };
        appendData(leadsFilePath, leadData);
        await sendSuccessEmail(
            parsedArgs.contactName,
            parsedArgs.companyName,
            this.callerId,
            parsedArgs.confirmedPhone,
            parsedArgs.appointmentTime
        );
        result = { status: 'Assessment scheduled successfully' };
      }

      else if (name === 'report_interaction') {
        const interactionData = {
            id: Date.now(),
            twilioCallerId: this.callerId,
            ...parsedArgs,
            createdAt: new Date().toISOString()
        };
        appendData(interactionsFilePath, interactionData);
        await sendReportEmail(this.callerId, parsedArgs.reason, parsedArgs.details);
        result = { status: 'Interaction logged' };
      }

      else if (name === 'end_call') {
        // Send a response output so AI knows it finished
        result = { status: 'Ending call in 10 seconds' };

        // Wait 10 seconds before closing to let the final goodbye audio stream completely
        if (!this.endTimeout) {
            this.endTimeout = setTimeout(() => {
                logger.info(`Executing end_call disconnect for ${this.callSid} after 10s delay`);
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this.ws.close();
                }
            }, 10000);
        }
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

      // Trigger a response generation so it can say goodbye or confirm
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
      this.callSid = data.start.callSid; // Update CallSid explicitly as per memory
      logger.info(`Stream started: ${this.streamSid} for call ${this.callSid}`);
    } else if (data.event === 'media') {
        const audioAppend = {
            type: 'input_audio_buffer.append',
            audio: data.media.payload
        };
        this.sendToOpenAI(audioAppend);
    }
  }
}
