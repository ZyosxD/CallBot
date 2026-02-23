import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendSuccessEmail, sendInteractionReport } from './emailService.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const leadsPath = path.join(__dirname, '../data/leads.json');
const interactionsPath = path.join(__dirname, '../data/interactions.json');

export class OpenAIRealtimeService {
  constructor(ws, callSid) {
    this.ws = ws;
    this.callSid = callSid;
    this.openaiWs = null;
    this.streamSid = null;
    this.callerId = 'Unknown';
    this.mode = 'inbound'; // Default
    this.sessionUpdatePending = false;
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
        if (this.sessionUpdatePending) {
            this.sendSessionUpdate();
            this.sessionUpdatePending = false;
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
    let systemInstruction = prompts.identity + "\n\n";
    if (this.mode === 'outbound') {
        systemInstruction += prompts.outbound;
    } else {
        systemInstruction += prompts.inbound;
    }

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
        instructions: systemInstruction,
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: prompts.tools,
        tool_choice: "auto"
      },
    };

    if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
        this.sendToOpenAI(sessionUpdate);
    } else {
        this.sessionUpdatePending = true;
    }
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
      } else if (name === 'report_interaction') {
        await this.handleReportInteraction(parsedArgs);
      } else if (name === 'end_call') {
        await this.handleEndCall(parsedArgs);
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

      // Trigger a response generation if not ending call
      if (name !== 'end_call') {
        this.sendToOpenAI({ type: 'response.create' });
      }

    } catch (error) {
      logger.error(`Error executing function ${name}:`, error);
    }
  }

  async handleScheduleAppointment(args) {
      const lead = {
          ...args,
          originalCallerId: this.callerId,
          timestamp: new Date().toISOString()
      };

      // Save to leads.json
      const leads = JSON.parse(fs.readFileSync(leadsPath, 'utf8'));
      leads.push(lead);
      fs.writeFileSync(leadsPath, JSON.stringify(leads, null, 2));

      // Send email
      await sendSuccessEmail(args.companyName, args.contactName, args.phoneNumber, args.appointmentTime, args.notes, this.callerId);
  }

  async handleReportInteraction(args) {
      const interaction = {
          ...args,
          originalCallerId: this.callerId,
          timestamp: new Date().toISOString()
      };

      // Save to interactions.json
      const interactions = JSON.parse(fs.readFileSync(interactionsPath, 'utf8'));
      interactions.push(interaction);
      fs.writeFileSync(interactionsPath, JSON.stringify(interactions, null, 2));

      // Send email
      await sendInteractionReport(args.outcome, args.notes, this.callerId);
  }

  async handleEndCall(args) {
      logger.info(`Ending call with reason: ${args.reason}`);
      // Wait 10 seconds before closing
      setTimeout(() => {
          if (this.ws) this.ws.close();
          if (this.openaiWs) this.openaiWs.close();
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
      this.callSid = data.start.callSid;

      // Extract custom parameters
      if (data.start.customParameters) {
          this.callerId = data.start.customParameters.callerId || 'Unknown';
          this.mode = data.start.customParameters.mode || 'inbound';
      }

      logger.info(`Stream started: ${this.streamSid}, CallerID: ${this.callerId}, Mode: ${this.mode}`);

      // Now that we have the parameters, update the session
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
