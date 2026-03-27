import WebSocket from 'ws';
import { config } from '../config/config.js';
import { SARAH_INBOUND, SARAH_OUTBOUND } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';
import fs from 'fs';
import path from 'path';

const leadsFilePath = path.join(process.cwd(), 'src', 'data', 'leads.json');
const interactionsFilePath = path.join(process.cwd(), 'src', 'data', 'interactions.json');

const appendData = (filePath, data) => {
    try {
        const fileData = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : [];
        fileData.push(data);
        fs.writeFileSync(filePath, JSON.stringify(fileData, null, 2));
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
    this.instructions = this.mode === 'outbound' ? SARAH_OUTBOUND : SARAH_INBOUND;
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

        // Instruct Sarah to initiate the conversation immediately
        setTimeout(() => {
           this.sendToOpenAI({
              type: 'response.create',
              response: {
                 instructions: "Start the conversation immediately by greeting the user and asking if they manage the technology or if you should speak with an Office Manager. Remember to use the 'Coral' voice and the persona guidelines."
              }
           });
        }, 500);
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
            silence_duration_ms: 1500
        },
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        voice: 'coral', // Sarah persona
        instructions: this.instructions,
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Schedule a Technical Assessment after collecting The Trifecta: Contact Name, Company Name, Confirmed Phone Number, and Exact Time.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the person we are scheduling with" },
                companyName: { type: "string", description: "Name of the company to check fiber map" },
                confirmedPhone: { type: "string", description: "Verbal confirmation of the best phone number to reach them" },
                appointmentTime: { type: "string", description: "The exact date and time agreed upon (e.g., 'Tomorrow at 10 AM')" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Log the interaction if the client is not interested, asks to call back later, or it reaches a voicemail.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Reason for the report (e.g., 'Not Interested', 'Call Back Later', 'Voicemail')" },
                notes: { type: "string", description: "Any additional notes from the conversation" }
              },
              required: ["reason"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call gracefully when the conversation reaches a natural conclusion.",
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
        const appointmentData = { ...parsedArgs, callerId: this.callerId, callSid: this.callSid, timestamp: new Date().toISOString() };
        appendData(leadsFilePath, appointmentData);
        await sendSuccessEmail(parsedArgs, this.callerId);
        result = { status: "success", message: "Appointment scheduled successfully." };
      } else if (name === 'report_interaction') {
        const interactionData = { ...parsedArgs, callerId: this.callerId, callSid: this.callSid, timestamp: new Date().toISOString() };
        appendData(interactionsFilePath, interactionData);
        await sendReportEmail(parsedArgs, this.callerId);
        result = { status: "success", message: "Interaction reported successfully." };
      } else if (name === 'end_call') {
        result = { status: "ending", message: "Call ending in 10 seconds." };
        this.handleEndCall();
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

      // Prompt OpenAI to continue or conclude
      if (name !== 'end_call') {
          this.sendToOpenAI({ type: 'response.create' });
      }

    } catch (error) {
      logger.error(`Error executing function ${name}:`, error);
      // Ensure we always reply to the function call
      const errorOutput = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify({ status: "error", message: error.message })
        }
      };
      this.sendToOpenAI(errorOutput);
      this.sendToOpenAI({ type: 'response.create' });
    }
  }

  handleEndCall() {
    logger.info(`End call requested. Initiating 10-second delay for ${this.callSid}`);

    // Prompt the AI to say goodbye
    this.sendToOpenAI({
       type: 'response.create',
       response: {
           instructions: "The conversation is ending. Please say a short, polite goodbye."
       }
    });

    setTimeout(() => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.close();
            logger.info(`WebSocket closed for ${this.callSid} after delay.`);
        }
        if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
            this.openaiWs.close();
            logger.info(`OpenAI WebSocket closed for ${this.callSid}.`);
        }
    }, 10000);
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
      // Explicitly update callSid from data.start if missing
      if (data.start.callSid) {
        this.callSid = data.start.callSid;
      }
      logger.info(`Stream started: ${this.streamSid} for CallSid: ${this.callSid}`);

      // We do not send session.update here because the WebSocket may not be open yet,
      // it is handled in the `open` event of openaiWs.
    } else if (data.event === 'media') {
        const audioAppend = {
            type: 'input_audio_buffer.append',
            audio: data.media.payload
        };
        this.sendToOpenAI(audioAppend);
    }
  }
}
