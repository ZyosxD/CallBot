import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class OpenAIRealtimeService {
  constructor(ws, callSid, callerId, mode) {
    this.ws = ws;
    this.callSid = callSid;
    this.callerId = callerId;
    this.mode = mode;
    this.openaiWs = null;
    this.streamSid = null;

    this.instructions = mode === 'outbound' ? prompts.SARAH_OUTBOUND : prompts.SARAH_INBOUND;
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
        logger.info(`Connected to OpenAI Realtime API. Mode: ${this.mode}, CallerId: ${this.callerId}`);
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
        turn_detection: { type: 'server_vad', silence_duration_ms: 1500 },
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        voice: 'coral',
        instructions: this.instructions,
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Schedule a technical assessment appointment with a 1Wire specialist.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the person scheduling the appointment" },
                companyName: { type: "string", description: "Name of the company" },
                confirmedPhone: { type: "string", description: "Verbal confirmation of the best phone number to call back" },
                appointmentTime: { type: "string", description: "Exact time requested for the appointment tomorrow (e.g. '10:00 AM')" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report the interaction if the user is not interested, asks to call back later, or it goes to voicemail.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Reason for reporting (e.g., 'Not Interested', 'Call Back Later', 'Voicemail')" },
                notes: { type: "string", description: "Any additional notes from the conversation" },
                confirmedPhone: { type: "string", description: "Any verbal phone number provided, if applicable" }
              },
              required: ["reason"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call politely after the conversation is finished.",
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

        // Instruct OpenAI to greet first depending on the mode
        let greetingPrompt = this.mode === 'outbound'
            ? 'Start the conversation immediately by greeting them and asking: "Are you the one who handles the tech, or should I ask for the Office Manager?"'
            : 'Start the conversation immediately by welcoming them to 1Wire and asking how you can help.';

        this.sendToOpenAI({
            type: 'response.create',
            response: {
                instructions: greetingPrompt
            }
        });
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
        const leadsPath = path.join(__dirname, '../data/leads.json');
        let leads = [];
        try { leads = JSON.parse(fs.readFileSync(leadsPath, 'utf8')); } catch (e) { leads = []; }

        const leadData = {
            id: Date.now(),
            callerId: this.callerId,
            ...parsedArgs
        };
        leads.push(leadData);
        fs.writeFileSync(leadsPath, JSON.stringify(leads, null, 2));

        await sendSuccessEmail(parsedArgs, this.callerId);
        result = { status: 'appointment_scheduled' };
      } else if (name === 'report_interaction') {
        const interactionsPath = path.join(__dirname, '../data/interactions.json');
        let interactions = [];
        try { interactions = JSON.parse(fs.readFileSync(interactionsPath, 'utf8')); } catch (e) { interactions = []; }

        const interactionData = {
            id: Date.now(),
            callerId: this.callerId,
            ...parsedArgs
        };
        interactions.push(interactionData);
        fs.writeFileSync(interactionsPath, JSON.stringify(interactions, null, 2));

        await sendReportEmail(parsedArgs, this.callerId);
        result = { status: 'interaction_reported' };
      } else if (name === 'end_call') {
        logger.info(`End call initiated for ${this.callSid}`);

        // Wait 10 seconds to allow for farewell audio to finish playing
        setTimeout(() => {
            logger.info(`Closing websocket connections for call ${this.callSid} after 10s delay`);
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.close();
            }
            if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
                this.openaiWs.close();
            }
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

      // Trigger a response generation if it's not ending
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
      // explicitly update callSid from start message
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
