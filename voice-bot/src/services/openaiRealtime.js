import WebSocket from 'ws';
import fs from 'fs/promises';
import path from 'path';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendNotification } from './emailService.js';

export class OpenAIRealtimeService {
  constructor(ws, callSid, callerId, mode) {
    this.ws = ws;
    this.callSid = callSid;
    this.callerId = callerId;
    this.mode = mode;
    this.openaiWs = null;
    this.streamSid = null;

    // Flags for race conditions
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
            description: "Schedule a technical assessment when the client agrees. You MUST collect contactName, companyName, confirmedPhone, and appointmentTime before calling this.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the person scheduling the assessment" },
                companyName: { type: "string", description: "Name of the company" },
                confirmedPhone: { type: "string", description: "The best phone number to reach them (must be confirmed verbally)" },
                appointmentTime: { type: "string", description: "Exact time agreed upon for the assessment tomorrow" },
                details: { type: "string", description: "Any extra details or needs detected during the pitch" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report the outcome when the client is not interested, asks to call back later, or if a voicemail is reached.",
            parameters: {
              type: "object",
              properties: {
                status: { type: "string", enum: ["not_interested", "callback_later", "voicemail", "gatekeeper_rejected", "other"], description: "The outcome of the call" },
                reason: { type: "string", description: "Brief reason or context for the outcome" },
                confirmedPhone: { type: "string", description: "The phone number if confirmed, otherwise empty" }
              },
              required: ["status", "reason"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the conversation when it is complete, after scheduling or reporting.",
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

    let parsedArgs = {};
    try {
      parsedArgs = JSON.parse(args);
    } catch (err) {
      logger.error(`Error parsing JSON arguments for ${name}:`, err);
      // Send error back to let model know it hallucinated malformed json
      this.sendFunctionOutput(callId, { error: "Invalid JSON arguments" });
      return;
    }

    let result = null;

    try {
      if (name === 'schedule_appointment') {
        const leadData = {
          callSid: this.callSid,
          callerId: this.callerId,
          timestamp: new Date().toISOString(),
          ...parsedArgs
        };

        // Log lead
        const leadsPath = path.join(process.cwd(), 'src', 'data', 'leads.json');
        await this.appendToFile(leadsPath, leadData);

        // Send Success Email
        await sendNotification('success', leadData);
        result = { status: "Appointment Scheduled Successfully" };

      } else if (name === 'report_interaction') {
        const reportData = {
          callSid: this.callSid,
          callerId: this.callerId,
          timestamp: new Date().toISOString(),
          ...parsedArgs
        };

        // Log interaction
        const interactionsPath = path.join(process.cwd(), 'src', 'data', 'interactions.json');
        await this.appendToFile(interactionsPath, reportData);

        // Send Report Email
        await sendNotification('report', reportData);
        result = { status: "Interaction Reported Successfully" };

      } else if (name === 'end_call') {
        logger.info(`Initiating end_call sequence for ${this.callSid}`);
        result = { status: "Ending call in 10 seconds. Please say goodbye." };

        // Let the AI speak a polite goodbye
        this.sendToOpenAI({ type: 'response.create' });

        setTimeout(() => {
          logger.info(`Closing WebSocket for ${this.callSid} after end_call delay.`);
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.close();
          }
        }, 10000);
      }

      this.sendFunctionOutput(callId, result);

      // Trigger a response generation for tools that are not end_call
      if (name !== 'end_call') {
        this.sendToOpenAI({ type: 'response.create' });
      }

    } catch (error) {
      logger.error(`Error executing function ${name}:`, error);
      this.sendFunctionOutput(callId, { error: error.message });
    }
  }

  sendFunctionOutput(callId, result) {
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

  async appendToFile(filePath, data) {
    try {
      let currentData = [];
      try {
        const fileContent = await fs.readFile(filePath, 'utf-8');
        if (fileContent) {
            currentData = JSON.parse(fileContent);
        }
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }

      currentData.push(data);
      await fs.writeFile(filePath, JSON.stringify(currentData, null, 2));
    } catch (err) {
      logger.error(`Failed to append to ${filePath}:`, err);
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
