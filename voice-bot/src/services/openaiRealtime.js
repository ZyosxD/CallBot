import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';

export class OpenAIRealtimeService {
  constructor(ws, callSid, callerId, mode) {
    this.ws = ws;
    this.callSid = callSid;
    this.callerId = callerId;
    this.mode = mode;
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

      // Prompt Sarah to start talking immediately
      this.sendToOpenAI({
          type: 'response.create',
          response: {
              instructions: "Start the conversation immediately with the greeting from your system prompt."
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
            description: "Schedule a Technical Assessment. Use this ONLY when you have collected the Trifecta (Contact Name, Company Name, Confirmed Phone) AND the exact appointment time.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the person scheduling the appointment" },
                companyName: { type: "string", description: "Name of the company" },
                confirmedPhone: { type: "string", description: "The phone number verbally confirmed by the user" },
                appointmentTime: { type: "string", description: "The agreed upon time for the appointment" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report the outcome of the interaction if no appointment was scheduled (e.g. not interested, voicemail, call back later)",
            parameters: {
              type: "object",
              properties: {
                outcome: { type: "string", description: "Short summary of the outcome" },
                notes: { type: "string", description: "Any additional notes" }
              },
              required: ["outcome"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call gracefully at the end of the conversation",
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
    let parsedArgs;

    try {
        parsedArgs = JSON.parse(args);
    } catch (e) {
        logger.error(`SyntaxError parsing arguments for ${name}: ${args}`, e);
        // resolve function call early with error
        this.resolveFunctionCall(callId, { error: 'SyntaxError: Malformed arguments' });
        return;
    }

    try {
      if (name === 'schedule_appointment') {
        const { contactName, companyName, confirmedPhone, appointmentTime } = parsedArgs;

        // Save lead
        const lead = {
            id: Date.now(),
            contactName,
            companyName,
            originalPhone: this.callerId,
            confirmedPhone,
            appointmentTime,
            dateAdded: new Date().toISOString()
        };
        const leadsFile = path.join(process.cwd(), 'src', 'data', 'leads.json');
        let leads = [];
        try {
            if (fs.existsSync(leadsFile)) leads = JSON.parse(fs.readFileSync(leadsFile, 'utf8'));
        } catch(e) {}
        leads.push(lead);
        fs.writeFileSync(leadsFile, JSON.stringify(leads, null, 2), 'utf8');

        await sendSuccessEmail(contactName, companyName, this.callerId, confirmedPhone, appointmentTime);
        result = { status: 'success' };
      }
      else if (name === 'report_interaction') {
        const { outcome, notes } = parsedArgs;

        // Save interaction
        const interaction = {
            id: Date.now(),
            callerId: this.callerId,
            outcome,
            notes,
            dateAdded: new Date().toISOString()
        };
        const interactionsFile = path.join(process.cwd(), 'src', 'data', 'interactions.json');
        let interactions = [];
        try {
            if (fs.existsSync(interactionsFile)) interactions = JSON.parse(fs.readFileSync(interactionsFile, 'utf8'));
        } catch(e) {}
        interactions.push(interaction);
        fs.writeFileSync(interactionsFile, JSON.stringify(interactions, null, 2), 'utf8');

        await sendReportEmail(this.callerId, outcome, notes || '');
        result = { status: 'success' };
      }
      else if (name === 'end_call') {
        result = { status: 'ending call in 10s' };

        // Command AI to say goodbye
        this.sendToOpenAI({
            type: 'response.create',
            response: {
                instructions: "Say a short, polite goodbye."
            }
        });

        // Close after 10s
        setTimeout(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.close();
            }
            if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
                this.openaiWs.close();
            }
        }, 10000);
      }

      this.resolveFunctionCall(callId, result);

      if (name !== 'end_call') {
          // Trigger a response generation after tools (except end call which has its own prompt)
          this.sendToOpenAI({ type: 'response.create' });
      }

    } catch (error) {
      logger.error(`Error executing function ${name}:`, error);
      this.resolveFunctionCall(callId, { error: 'Internal Server Error' });
    }
  }

  resolveFunctionCall(callId, result) {
      const functionOutput = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify(result)
        }
      };
      this.sendToOpenAI(functionOutput);
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
      // Re-assign explicitly in case
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
