import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendReportEmail } from './emailService.js';
import twilio from 'twilio';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
        this.sendInitialGreeting();
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
    const isOutbound = this.mode === 'outbound';
    const instructions = isOutbound ? prompts.SARAH_OUTBOUND : prompts.SARAH_INBOUND;

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
        voice: 'coral',
        instructions: instructions,
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Use this to schedule a Technical Assessment after the customer says YES. DO NOT trigger this without collecting The Trifecta + Exact Time.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "The name of the person we are scheduling with" },
                companyName: { type: "string", description: "The name of their business/company" },
                confirmedPhone: { type: "string", description: "The best phone number to reach them at (e.g. cell phone)" },
                appointmentTime: { type: "string", description: "The exact date and time agreed upon for the call back" },
                notes: { type: "string", description: "Any extra notes about their needs (e.g. slow internet, looking for cloud PBX)" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Use this if the customer is not interested, asks to call back later, or if it goes to voicemail.",
            parameters: {
              type: "object",
              properties: {
                outcome: { type: "string", description: "The outcome of the call (e.g., NOT_INTERESTED, CALL_BACK_LATER, VOICEMAIL)" },
                summary: { type: "string", description: "A brief summary of what happened during the call" }
              },
              required: ["outcome", "summary"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "Use this when the conversation has naturally concluded and it's time to hang up.",
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

  sendInitialGreeting() {
    const isOutbound = this.mode === 'outbound';
    const greetingText = isOutbound
      ? "Hey there! I'm Sarah with 1Wire. Do you handle the technology there, or should I ask for the Office Manager?"
      : "Thank you for calling 1Wire! This is Sarah, how can I help you today?";

    const greetingEvent = {
      type: 'response.create',
      response: {
        instructions: `Start the conversation immediately. Say exactly: "${greetingText}"`
      }
    };
    this.sendToOpenAI(greetingEvent);
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
          ...parsedArgs,
          callerId: this.callerId,
          callSid: this.callSid,
          timestamp: new Date().toISOString()
        };

        const leadsPath = path.join(__dirname, '../data/leads.json');
        let leads = [];
        if (fs.existsSync(leadsPath)) {
          leads = JSON.parse(fs.readFileSync(leadsPath, 'utf8'));
        }
        leads.push(leadData);
        fs.writeFileSync(leadsPath, JSON.stringify(leads, null, 2));

        sendReportEmail('SUCCESS', leadData);
        result = { status: 'success', message: 'Appointment scheduled successfully.' };
      } else if (name === 'report_interaction') {
        const interactionData = {
          ...parsedArgs,
          callerId: this.callerId,
          callSid: this.callSid,
          timestamp: new Date().toISOString()
        };

        const interactionsPath = path.join(__dirname, '../data/interactions.json');
        let interactions = [];
        if (fs.existsSync(interactionsPath)) {
          interactions = JSON.parse(fs.readFileSync(interactionsPath, 'utf8'));
        }
        interactions.push(interactionData);
        fs.writeFileSync(interactionsPath, JSON.stringify(interactions, null, 2));

        sendReportEmail('REPORT', interactionData);
        result = { status: 'success', message: 'Interaction reported.' };
      } else if (name === 'end_call') {
        logger.info(`Ending call ${this.callSid} in 10 seconds...`);
        setTimeout(async () => {
          if (this.ws && this.ws.readyState === 1) {
            this.ws.close();
          }
          if (this.openaiWs && this.openaiWs.readyState === 1) {
            this.openaiWs.close();
          }
          try {
            const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
            await twilioClient.calls(this.callSid).update({ status: 'completed' });
          } catch (err) {
            logger.error('Error updating Twilio call status on end_call:', err);
          }
        }, 10000); // 10s delay

        result = { status: 'success', message: 'Call will be ended in 10 seconds.' };
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
