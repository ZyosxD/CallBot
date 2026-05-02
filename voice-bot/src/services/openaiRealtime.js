import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger from '../utils/logger.js';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';

export class OpenAIRealtimeService {
  constructor(ws, callSid, mode, callerId) {
    this.ws = ws;
    this.callSid = callSid;
    this.mode = mode; // 'inbound' or 'outbound'
    this.callerId = callerId;
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

      this.openaiWs.on('close', async () => {
        logger.info('OpenAI WebSocket Closed');
        // Release drip lock if outbound call disconnected
        try {
          const { markCallEnded } = await import('./dripService.js');
          markCallEnded(this.callSid);
        } catch (err) {
           logger.error('Error importing markCallEnded:', err);
        }
      });

    } catch (error) {
      logger.error('Error connecting to OpenAI:', error);
    }
  }

  checkAndInitializeSession() {
    if (this.isOpenAiConnected && this.isTwilioStarted) {
      this.sendSessionUpdate();
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
            description: "Schedule a Technical Assessment. Trigger only when client says YES and you have collected The Trifecta.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the person" },
                companyName: { type: "string", description: "Name of the company" },
                confirmedPhone: { type: "string", description: "The confirmed phone number" },
                appointmentTime: { type: "string", description: "The exact time tomorrow" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report an interaction when client is not interested, asks to call back later, or reaches voicemail.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Reason for reporting (e.g. not interested, voicemail)" },
                details: { type: "string", description: "Additional details about the interaction" }
              },
              required: ["reason", "details"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call after the conversation is finished.",
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
    let result = { status: "success" };

    let parsedArgs = {};
    try {
        parsedArgs = JSON.parse(args);
    } catch (e) {
        logger.error(`Failed to parse args for ${name}: ${args}`);
        result = { status: "error", message: "Invalid arguments format" };
    }

    try {
      if (name === 'schedule_appointment' && result.status === 'success') {
        const { contactName, companyName, confirmedPhone, appointmentTime } = parsedArgs;

        // Save to leads.json
        const leadsPath = path.join(process.cwd(), 'src', 'data', 'leads.json');
        let leads = [];
        try { leads = JSON.parse(fs.readFileSync(leadsPath, 'utf8')); } catch(e) {}
        leads.push({ callSid: this.callSid, contactName, companyName, confirmedPhone, appointmentTime, timestamp: new Date().toISOString() });
        fs.writeFileSync(leadsPath, JSON.stringify(leads, null, 2));

        // Send Success Email
        await sendSuccessEmail(contactName, companyName, confirmedPhone, appointmentTime, this.callerId);

      } else if (name === 'report_interaction' && result.status === 'success') {
        const { reason, details } = parsedArgs;

        // Save to interactions.json
        const interactionsPath = path.join(process.cwd(), 'src', 'data', 'interactions.json');
        let interactions = [];
        try { interactions = JSON.parse(fs.readFileSync(interactionsPath, 'utf8')); } catch(e) {}
        interactions.push({ callSid: this.callSid, reason, details, timestamp: new Date().toISOString() });
        fs.writeFileSync(interactionsPath, JSON.stringify(interactions, null, 2));

        // Send Report Email
        await sendReportEmail(this.callSid, reason, details, this.callerId);

      } else if (name === 'end_call') {
         logger.info(`Ending call ${this.callSid} in 10 seconds...`);
         setTimeout(() => {
             if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                 this.ws.close();
             }
             if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
                 this.openaiWs.close();
             }
         }, 10000);
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

      // Trigger a response generation for polite goodbye before closing if end_call
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
