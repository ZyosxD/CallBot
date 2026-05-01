import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';

export class OpenAIRealtimeService {
  constructor(ws, callSid) {
    this.ws = ws;
    this.callSid = callSid;
    this.callerId = 'unknown';
    this.mode = 'SARAH_INBOUND';
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
        this.isOpenAiConnected = false;
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
    const instructions = this.mode === 'SARAH_OUTBOUND'
      ? prompts.systemInstructionOutbound
      : prompts.systemInstructionInbound;

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
            description: "Triggers when client says YES. Requires the Trifecta: Contact Name, Company Name, Confirmed Phone, and exact Appointment Time.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string" },
                companyName: { type: "string" },
                confirmedPhone: { type: "string", description: "The verbally verified phone number" },
                appointmentTime: { type: "string", description: "The agreed upon time for the human to call back" },
                notes: { type: "string" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Triggers when client is not interested, asks to call back later, or reaches voicemail.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Not interested, Voicemail, Call Later, etc." },
                details: { type: "string" }
              },
              required: ["reason"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "Use this to hang up the phone when the conversation is completely finished.",
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
    const { name, arguments: args, call_id: callId } = event;
    logger.info(`Function call detected: ${name} with args: ${args}`);

    let parsedArgs = {};
    try {
      if (args) {
        parsedArgs = JSON.parse(args);
      }
    } catch (err) {
      logger.error(`SyntaxError parsing tool arguments for ${name}:`, err);
    }

    let result = { status: 'success' };

    try {
      if (name === 'schedule_appointment') {
        // Save to leads.json
        const leadsPath = path.join(process.cwd(), 'src', 'data', 'leads.json');
        let leads = [];
        if (fs.existsSync(leadsPath)) {
          leads = JSON.parse(fs.readFileSync(leadsPath, 'utf8'));
        }
        leads.push({ ...parsedArgs, callSid: this.callSid, originalCallerId: this.callerId, timestamp: new Date().toISOString() });
        fs.writeFileSync(leadsPath, JSON.stringify(leads, null, 2));

        // Send success email
        await sendSuccessEmail(parsedArgs, this.callerId);

      } else if (name === 'report_interaction') {
        // Save to interactions.json
        const interactionsPath = path.join(process.cwd(), 'src', 'data', 'interactions.json');
        let interactions = [];
        if (fs.existsSync(interactionsPath)) {
          interactions = JSON.parse(fs.readFileSync(interactionsPath, 'utf8'));
        }
        interactions.push({ ...parsedArgs, callSid: this.callSid, phone: this.callerId, timestamp: new Date().toISOString() });
        fs.writeFileSync(interactionsPath, JSON.stringify(interactions, null, 2));

        // Send report email
        await sendReportEmail(parsedArgs, this.callerId);

      } else if (name === 'end_call') {
        logger.info(`End call tool triggered. Initiating 10s countdown for closing.`);

        // Trigger goodbye response
        this.sendToOpenAI({ type: 'response.create' });

        setTimeout(async () => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.close();
          }
          if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
            this.openaiWs.close();
          }

          const { markCallEnded } = await import('./dripService.js');
          markCallEnded(this.callSid);

        }, 10000); // 10 seconds delay
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

      if (name !== 'end_call') {
         this.sendToOpenAI({ type: 'response.create' });
      }

    } catch (error) {
      logger.error(`Error executing function ${name}:`, error);
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
