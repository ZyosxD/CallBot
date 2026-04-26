import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendAppointmentEmail, sendReportEmail } from './emailService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const leadsFilePath = path.join(__dirname, '../data/leads.json');
const interactionsFilePath = path.join(__dirname, '../data/interactions.json');

export class OpenAIRealtimeService {
  constructor(ws, callSid) {
    this.ws = ws;
    this.callSid = callSid;
    this.callerId = 'unknown';
    this.mode = 'inbound';
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
        instructions: prompts.systemInstruction,
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Schedule a technical assessment. MUST NOT BE CALLED UNLESS Contact Name, Company Name, Verified Phone, and Exact Time are collected.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the person" },
                companyName: { type: "string", description: "Company name" },
                confirmedPhone: { type: "string", description: "Phone number explicitly verified by the user" },
                appointmentTime: { type: "string", description: "Exact date and time agreed upon" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Log the interaction if the client is not interested, asks to call back later, or if it reached a voicemail.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Reason why appointment wasn't scheduled (e.g. not interested, callback later, voicemail)" },
                notes: { type: "string", description: "Any additional details or context from the call" }
              },
              required: ["reason"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call and disconnect gracefully. Call this when the conversation is completely finished after saying goodbye.",
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
    } catch (error) {
        logger.error(`Failed to parse arguments for ${name}: ${error.message}`);
        // Return error to prevent model hanging
        const errorOutput = {
            type: 'conversation.item.create',
            item: {
              type: 'function_call_output',
              call_id: callId,
              output: JSON.stringify({ error: "Invalid JSON arguments" })
            }
        };
        this.sendToOpenAI(errorOutput);
        this.sendToOpenAI({ type: 'response.create' });
        return;
    }

    let result = null;

    try {
      if (name === 'schedule_appointment') {
        result = await this.executeScheduleAppointment(parsedArgs);
      } else if (name === 'report_interaction') {
        result = await this.executeReportInteraction(parsedArgs);
      } else if (name === 'end_call') {
        result = await this.executeEndCall();
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

      // Trigger a response generation, unless ending call
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

  async executeScheduleAppointment(args) {
      const { contactName, companyName, confirmedPhone, appointmentTime } = args;

      const leadData = {
          contactName,
          companyName,
          confirmedPhone,
          appointmentTime,
          callerId: this.callerId,
          mode: this.mode,
          timestamp: new Date().toISOString()
      };

      try {
          let leads = [];
          if (fs.existsSync(leadsFilePath)) {
              leads = JSON.parse(fs.readFileSync(leadsFilePath, 'utf8'));
          }
          leads.push(leadData);
          fs.writeFileSync(leadsFilePath, JSON.stringify(leads, null, 2));
      } catch (err) {
          logger.error(`Failed to save lead: ${err}`);
      }

      await sendAppointmentEmail(contactName, companyName, confirmedPhone, appointmentTime, this.callerId);

      return { status: "Appointment successfully scheduled and logged." };
  }

  async executeReportInteraction(args) {
      const { reason, notes } = args;

      const interactionData = {
          reason,
          notes: notes || "",
          callerId: this.callerId,
          mode: this.mode,
          timestamp: new Date().toISOString()
      };

      try {
          let interactions = [];
          if (fs.existsSync(interactionsFilePath)) {
              interactions = JSON.parse(fs.readFileSync(interactionsFilePath, 'utf8'));
          }
          interactions.push(interactionData);
          fs.writeFileSync(interactionsFilePath, JSON.stringify(interactions, null, 2));
      } catch (err) {
          logger.error(`Failed to save interaction: ${err}`);
      }

      await sendReportEmail(this.callerId, reason, notes);

      return { status: "Interaction successfully reported." };
  }

  async executeEndCall() {
      logger.info(`Initiating end_call sequence for CallSid: ${this.callSid}`);

      // Prompt a final goodbye
      this.sendToOpenAI({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'system',
            content: [{ type: 'input_text', text: 'Say a short, polite goodbye right now.' }]
          }
      });
      this.sendToOpenAI({ type: 'response.create' });

      // Wait 10 seconds before forcefully closing the connection
      setTimeout(() => {
          logger.info(`10 second timeout reached. Closing WebSocket for CallSid: ${this.callSid}`);
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
              this.ws.close();
          }
          if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
              this.openaiWs.close();
          }
      }, 10000);

      return { status: "Call ending sequence initiated. Goodbye." };
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
      this.isTwilioStarted = true;
      logger.info(`Stream started: ${this.streamSid}`);
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
