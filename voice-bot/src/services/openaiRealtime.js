import fs from 'fs';
import path from 'path';
import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';

export class OpenAIRealtimeService {
  constructor(ws, callSid, callerId, mode) {
    this.ws = ws;
    this.callSid = callSid;
    this.callerId = callerId;
    this.mode = mode || 'inbound';
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
        logger.info(`OpenAI WS Open for ${this.callSid}`);
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
        logger.info(`OpenAI WebSocket Closed for ${this.callSid}`);
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
            description: "Schedule a Technical Assessment. Use this ONLY when you have collected the user's name, company name, confirmed phone number, and exact appointment time.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "The name of the person" },
                companyName: { type: "string", description: "The name of the company" },
                confirmedPhone: { type: "string", description: "The verbally confirmed phone number" },
                appointmentTime: { type: "string", description: "The exact time for the appointment" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report an interaction that did not result in an appointment (e.g., user is not interested, asked to call back, or reached voicemail).",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Reason for reporting (e.g., Not interested, Call back later, Voicemail)" }
              },
              required: ["reason"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call gracefully. Call this tool after you have scheduled an appointment or reported the interaction and said goodbye.",
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

    // AI speaks first
    const firstMessageText = this.mode === 'outbound'
        ? "Hello, are you the one handling the technology, or should I ask for the Office Manager?"
        : "Hello, thank you for calling 1Wire. Are you calling for sales or support?";

    this.sendToOpenAI({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Start the conversation immediately. Say exactly: " + firstMessageText }]
      }
    });

    this.sendToOpenAI({ type: "response.create" });
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
    let parsedArgs = {};
    let result = null;

    logger.info(`Function call detected: ${name} with args: ${args}`);

    try {
        parsedArgs = JSON.parse(args);
    } catch (e) {
        logger.error(`SyntaxError parsing tool args for ${name}:`, e);
        // Continue execution but tool logic might fail
    }

    try {
      if (name === 'schedule_appointment') {
        const leadData = {
            callSid: this.callSid,
            callerId: this.callerId,
            ...parsedArgs,
            timestamp: new Date().toISOString()
        };
        this.saveData('leads.json', leadData);
        await sendSuccessEmail(leadData);
        result = { status: "Success", message: "Appointment Scheduled" };

      } else if (name === 'report_interaction') {
        const interactionData = {
            callSid: this.callSid,
            callerId: this.callerId,
            reason: parsedArgs.reason || 'Unknown',
            timestamp: new Date().toISOString()
        };
        this.saveData('interactions.json', interactionData);
        await sendReportEmail(interactionData);
        result = { status: "Reported", message: "Interaction logged." };

      } else if (name === 'end_call') {
        result = { status: "Closing", message: "Ending the call shortly." };

        // Send the function output back FIRST to avoid hanging the model
        const functionOutput = {
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: callId,
            output: JSON.stringify(result)
          }
        };
        this.sendToOpenAI(functionOutput);

        // Instruct a goodbye and then wait 10 seconds before closing socket
        this.sendToOpenAI({
            type: "conversation.item.create",
            item: {
                type: "message",
                role: "user",
                content: [{ type: "input_text", text: "Say a short, polite goodbye right now." }]
            }
        });
        this.sendToOpenAI({ type: 'response.create' });

        setTimeout(() => {
            if (this.ws) {
                this.ws.close();
            }
            if (this.openaiWs) {
                this.openaiWs.close();
            }
        }, 10000);
        return; // Return early because we already sent the function output
      }

      // Send result back to OpenAI for schedule/report
      const functionOutput = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify(result)
        }
      };
      this.sendToOpenAI(functionOutput);
      this.sendToOpenAI({ type: 'response.create' });

    } catch (error) {
      logger.error(`Error executing function ${name}:`, error);
    }
  }

  saveData(filename, data) {
    try {
        const filePath = path.join(process.cwd(), 'src', 'data', filename);
        let currentData = [];
        if (fs.existsSync(filePath)) {
            const fileContent = fs.readFileSync(filePath, 'utf8');
            currentData = JSON.parse(fileContent);
        }
        currentData.push(data);
        fs.writeFileSync(filePath, JSON.stringify(currentData, null, 2));
    } catch (error) {
        logger.error(`Error saving data to ${filename}:`, error);
    }
  }

  sendAudioToTwilio(audioPayload) {
    if (this.ws && this.streamSid) {
      const audioDelta = {
        event: 'media',
        streamSid: this.streamSid,
        media: {
          payload: audioPayload
        }
      };
      // For fastify/websocket v11, ws is the connection object or socket
      const socket = this.ws.socket ? this.ws.socket : this.ws;
      if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(audioDelta));
      }
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
      this.callSid = data.start.callSid; // explicitly update
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