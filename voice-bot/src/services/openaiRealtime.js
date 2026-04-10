import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { sendAppointmentEmail, sendReportEmail } from './emailService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const leadsFilePath = path.join(__dirname, '../data/leads.json');
const interactionsFilePath = path.join(__dirname, '../data/interactions.json');

export class OpenAIRealtimeService {
  constructor(ws, callSid, mode, callerId) {
    this.ws = ws;
    this.callSid = callSid;
    this.mode = mode;
    this.callerId = callerId;
    this.openaiWs = null;
    this.streamSid = null;
    this.isOpenAiConnected = false;
    this.isTwilioStarted = false;
    this.sessionInitialized = false;
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
    if (this.isOpenAiConnected && this.isTwilioStarted && !this.sessionInitialized) {
      this.sessionInitialized = true;
      this.sendSessionUpdate();

      // Force first interaction
      const greeting = this.mode === 'outbound' ? prompts.outboundGreeting : prompts.inboundGreeting;
      this.sendToOpenAI({
        type: 'response.create',
        response: {
          instructions: `Start the conversation immediately by saying exactly: "${greeting}"`
        }
      });
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
            description: "Schedule a Technical Assessment. Use this ONLY after successfully pitching and confirming 'The Trifecta' from the user.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the person handling technology (IT Manager/Owner)" },
                companyName: { type: "string", description: "Name of the company" },
                confirmedPhone: { type: "string", description: "The best phone number to call them back on" },
                appointmentTime: { type: "string", description: "Exact time for the assessment tomorrow" },
                needs: { type: "string", description: "Any notes about their IT, VoIP, or Internet needs" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Log the interaction if the client is not interested, asks to call back later, or if the call goes to voicemail.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Reason for logging (e.g., 'Not interested', 'Call back later', 'Voicemail')" },
                notes: { type: "string", description: "Any additional details" }
              },
              required: ["reason"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call and disconnect. Use this when the conversation is completely finished.",
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

    logger.info(`Function call detected: ${name} with args: ${args}`);
    let result = null;
    let parsedArgs = {};

    try {
      parsedArgs = JSON.parse(args);
    } catch (e) {
      logger.error(`Failed to parse arguments for ${name}: ${args}`, e);
      result = { error: "Invalid JSON arguments" };
    }

    if (!result) {
      try {
        if (name === 'schedule_appointment') {
          const leadData = { ...parsedArgs, callerId: this.callerId, callSid: this.callSid, timestamp: new Date().toISOString() };

          let leads = [];
          try { leads = JSON.parse(await fs.readFile(leadsFilePath, 'utf-8')); } catch(e){}
          leads.push(leadData);
          await fs.writeFile(leadsFilePath, JSON.stringify(leads, null, 2));

          await sendAppointmentEmail(
            parsedArgs.contactName,
            parsedArgs.companyName,
            parsedArgs.confirmedPhone,
            this.callerId,
            parsedArgs.appointmentTime,
            parsedArgs.needs
          );

          result = { status: "Success", message: "Appointment scheduled successfully." };
        } else if (name === 'report_interaction') {
          const interactionData = { ...parsedArgs, callerId: this.callerId, callSid: this.callSid, timestamp: new Date().toISOString() };

          let interactions = [];
          try { interactions = JSON.parse(await fs.readFile(interactionsFilePath, 'utf-8')); } catch(e){}
          interactions.push(interactionData);
          await fs.writeFile(interactionsFilePath, JSON.stringify(interactions, null, 2));

          await sendReportEmail(parsedArgs.reason, this.callerId, parsedArgs.notes);

          result = { status: "Success", message: "Interaction reported." };
        } else if (name === 'end_call') {
          result = { status: "ending_call" };

          // Send function output first so OpenAI doesn't hang
          this.sendToOpenAI({
            type: 'conversation.item.create',
            item: {
              type: 'function_call_output',
              call_id: callId,
              output: JSON.stringify(result)
            }
          });

          // Instruct to say goodbye before ending
          this.sendToOpenAI({
            type: 'response.create',
            response: {
              instructions: `Say a short polite goodbye exactly like this: "${prompts.goodbye}"`
            }
          });

          setTimeout(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
              this.ws.close();
            }
          }, 10000);
          return; // Skip normal output sending
        }

      } catch (error) {
        logger.error(`Error executing function ${name}:`, error);
        result = { error: "Execution failed" };
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

    // Trigger a response generation
    this.sendToOpenAI({ type: 'response.create' });
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
      this.callSid = data.start.callSid;
      this.streamSid = data.start.streamSid;
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
