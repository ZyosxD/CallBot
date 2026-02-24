import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendAppointmentEmail, sendReportEmail } from './emailService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LEADS_FILE = path.join(__dirname, '../data/leads.json');
const INTERACTIONS_FILE = path.join(__dirname, '../data/interactions.json');

export class OpenAIRealtimeService {
  constructor(ws, callSid) {
    this.ws = ws;
    this.callSid = callSid;
    this.openaiWs = null;
    this.streamSid = null;
    this.mode = 'inbound'; // Default
    this.callerId = 'unknown';
    this.customParameters = {};
    this.pendingSessionUpdate = false;
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
        if (this.pendingSessionUpdate) {
            this.sendSessionUpdate();
            this.pendingSessionUpdate = false;
        }
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
    if (!this.openaiWs || this.openaiWs.readyState !== WebSocket.OPEN) {
        this.pendingSessionUpdate = true;
        return;
    }

    const modePrompt = prompts[this.mode] || prompts.inbound;
    const instructions = `${prompts.systemInstruction}\n\n${modePrompt}`;

    const sessionUpdate = {
      type: 'session.update',
      session: {
        turn_detection: { type: 'server_vad', threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 1500 },
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        voice: 'coral',
        instructions: instructions,
        modalities: ["text", "audio"],
        temperature: 0.7,
        tools: prompts.tools,
        tool_choice: "auto"
      },
    };
    this.sendToOpenAI(sessionUpdate);

    // Trigger initial greeting
    // Only send this once per session start
    const greeting = "Hello? Is this the right number?"; // Generic
    // Or customize based on mode
    let greetingInstruction = "Start the conversation immediately. Introduce yourself briefly.";
    if (this.mode === 'outbound') {
        greetingInstruction = "Start the conversation immediately. Ask for the person in charge of technology or the office manager.";
    } else {
        greetingInstruction = "Start the conversation immediately. Say 'Thanks for calling 1Wire, this is Sarah. How can I help you today?'";
    }

    this.sendToOpenAI({
        type: 'response.create',
        response: {
            instructions: greetingInstruction
        }
    });
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
    let result = { success: true };

    try {
      if (name === 'schedule_appointment') {
        await this.handleScheduleAppointment(parsedArgs);
        result = { status: 'scheduled' };
      } else if (name === 'report_interaction') {
        await this.handleReportInteraction(parsedArgs);
        result = { status: 'reported' };
      } else if (name === 'end_call') {
        this.handleEndCall();
        result = { status: 'ending' };
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

      if (name !== 'end_call') {
          this.sendToOpenAI({ type: 'response.create' });
      }

    } catch (error) {
      logger.error(`Error executing function ${name}:`, error);
    }
  }

  async handleScheduleAppointment(args) {
    try {
        // Save to leads.json
        const lead = { ...args, originalCallerId: this.callerId, timestamp: new Date().toISOString() };

        let leads = [];
        if (fs.existsSync(LEADS_FILE)) {
             const leadsData = fs.readFileSync(LEADS_FILE, 'utf8');
             leads = JSON.parse(leadsData);
        }
        leads.push(lead);
        fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));

        // Send Email
        await sendAppointmentEmail(lead);
    } catch (e) {
        logger.error('Error in handleScheduleAppointment', e);
    }
  }

  async handleReportInteraction(args) {
    try {
        // Save to interactions.json
        const interaction = { ...args, originalCallerId: this.callerId, timestamp: new Date().toISOString() };

        let interactions = [];
        if (fs.existsSync(INTERACTIONS_FILE)) {
            const interactionsData = fs.readFileSync(INTERACTIONS_FILE, 'utf8');
            interactions = JSON.parse(interactionsData);
        }
        interactions.push(interaction);
        fs.writeFileSync(INTERACTIONS_FILE, JSON.stringify(interactions, null, 2));

        // Send Email
        await sendReportEmail(interaction);
    } catch (e) {
        logger.error('Error in handleReportInteraction', e);
    }
  }

  handleEndCall() {
      logger.info('Bot requested to end call. Waiting 10s...');
      setTimeout(() => {
          logger.info('Closing connection now.');
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
              this.ws.close();
          }
          if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
              this.openaiWs.close();
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
      const customParams = data.start.customParameters || {};
      this.mode = customParams.mode || 'inbound';
      this.callerId = customParams.callerId || 'unknown';

      logger.info(`Stream started: ${this.streamSid}, Mode: ${this.mode}, Caller: ${this.callerId}`);

      // Now that we know the mode, update the session
      this.sendSessionUpdate();

    } else if (data.event === 'media') {
        const audioAppend = {
            type: 'input_audio_buffer.append',
            audio: data.media.payload
        };
        this.sendToOpenAI(audioAppend);
    }
  }
}
