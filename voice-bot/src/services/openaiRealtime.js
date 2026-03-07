import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendSuccessReport, sendInteractionReport } from './emailService.js';
import { handleCallEnded } from './dripService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const leadsPath = path.join(__dirname, '..', 'data', 'leads.json');
const interactionsPath = path.join(__dirname, '..', 'data', 'interactions.json');

export class OpenAIRealtimeService {
  constructor(ws, callSid, callerId, mode) {
    this.ws = ws;
    this.callSid = callSid;
    this.callerId = callerId;
    this.mode = mode; // 'inbound' or 'outbound'
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
        logger.error(`OpenAI WebSocket Error: ${error.message}`);
      });

      this.openaiWs.on('close', () => {
        logger.info('OpenAI WebSocket Closed');
      });

    } catch (error) {
      logger.error(`Error connecting to OpenAI: ${error.message}`);
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
        voice: 'coral', // Use the 'coral' voice
        instructions: systemPrompt,
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Schedule a technical assessment after the client agrees and provides all required data (The Trifecta: Contact Name, Company Name, Confirmed Phone, and exact Appointment Time).",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the person to contact (e.g., IT Manager or Owner)" },
                companyName: { type: "string", description: "Name of the company" },
                confirmedPhone: { type: "string", description: "Verbally confirmed best phone number to call" },
                appointmentTime: { type: "string", description: "Exact date and time agreed upon for the call" },
                notes: { type: "string", description: "Any extra notes about their current setup or issues" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Log an interaction if the call ends without scheduling an appointment (e.g., client is not interested, asks to call later, or voicemail).",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Reason for the interaction outcome (e.g., Not Interested, Voicemail)" },
                notes: { type: "string", description: "Any extra notes" }
              },
              required: ["reason"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call gracefully. This will say a goodbye and close the connection after 10 seconds.",
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

    // Trigger AI to speak first
    const greeting = this.mode === 'outbound'
        ? "Hi, um, am I speaking with the person who handles the technology, or should I ask for the Office Manager?"
        : "Hi, thanks for calling 1Wire! Um, are you calling about Internet, VoIP, or IT services?";

    this.sendToOpenAI({
        type: 'conversation.item.create',
        item: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: `Start the conversation immediately by saying exactly this: "${greeting}"` }]
        }
    });
    this.sendToOpenAI({ type: 'response.create' });
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
      logger.error(`Error parsing OpenAI message: ${error.message}`);
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
        // Save to leads.json
        const leadsData = fs.readFileSync(leadsPath, 'utf8');
        const leads = JSON.parse(leadsData);
        leads.push({ timestamp: new Date().toISOString(), callerId: this.callerId, ...parsedArgs });
        fs.writeFileSync(leadsPath, JSON.stringify(leads, null, 2));

        // Send Success Email
        await sendSuccessReport({ callerId: this.callerId, ...parsedArgs });
        result = { status: 'success', message: 'Appointment scheduled and email sent.' };

      } else if (name === 'report_interaction') {
        // Save to interactions.json
        const interactionsData = fs.readFileSync(interactionsPath, 'utf8');
        const interactions = JSON.parse(interactionsData);
        interactions.push({ timestamp: new Date().toISOString(), callerId: this.callerId, ...parsedArgs });
        fs.writeFileSync(interactionsPath, JSON.stringify(interactions, null, 2));

        // Send Interaction Email
        await sendInteractionReport({ callerId: this.callerId, ...parsedArgs });
        result = { status: 'success', message: 'Interaction logged and email sent.' };

      } else if (name === 'end_call') {
        result = { status: 'ending', message: 'Hanging up in 10 seconds.' };
        // Wait 10s to allow goodbye message to play
        setTimeout(() => {
            logger.info('10 seconds passed, closing WebSocket for end_call.');
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

      // Trigger a response generation
      this.sendToOpenAI({ type: 'response.create' });

    } catch (error) {
      logger.error(`Error executing function ${name}: ${error.message}`);
      const errorOutput = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify({ error: error.message })
        }
      };
      this.sendToOpenAI(errorOutput);
      this.sendToOpenAI({ type: 'response.create' });
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
      // Note: we update callSid directly from twilio stream start
      this.callSid = data.start.callSid;
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
