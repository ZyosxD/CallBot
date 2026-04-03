import WebSocket from 'ws';
import { promises as fs } from 'fs';
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
    this.mode = mode || 'inbound';
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
      this.sendSessionUpdate();
      this.sessionInitialized = true;
    }
  }

  sendSessionUpdate() {
    const instructions = this.mode === 'outbound' ? prompts.SARAH_OUTBOUND : prompts.SARAH_INBOUND;
    const initialMessage = this.mode === 'outbound'
        ? 'Start the conversation immediately by introducing yourself and asking for the IT manager.'
        : 'Start the conversation immediately with a polite greeting and ask how you can help.';

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
            description: "Use this to schedule a technical assessment when the user has provided their Name, Company Name, Verified Phone Number, and desired Time.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "The person we should ask for" },
                companyName: { type: "string", description: "The name of the company" },
                confirmedPhone: { type: "string", description: "The phone number verbally confirmed by the user" },
                appointmentTime: { type: "string", description: "The exact time agreed upon" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Use this to log the interaction if they are not interested, want a call back later, or if it is a voicemail.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Why it didn't result in an appointment (e.g., 'Not interested', 'Voicemail', 'Call back later')" },
                summary: { type: "string", description: "A brief summary of the conversation" }
              },
              required: ["reason", "summary"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call gracefully after finishing the conversation.",
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

    // Prompt OpenAI to start the conversation
    this.sendToOpenAI({
        type: 'conversation.item.create',
        item: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: initialMessage }]
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
        parsedArgs = JSON.parse(args);
    } catch (e) {
        logger.error(`Failed to parse function arguments for ${name}: ${args}`, e);
        // Continue execution with empty args to prevent unhandled rejections
    }

    let result = null;

    try {
      if (name === 'schedule_appointment') {
        await this.handleScheduleAppointment(parsedArgs);
        result = { status: 'appointment_scheduled' };
      } else if (name === 'report_interaction') {
        await this.handleReportInteraction(parsedArgs);
        result = { status: 'interaction_reported' };
      } else if (name === 'end_call') {
        // Handle end call logic safely
        result = { status: 'ending_call' };
        this.handleEndCall(callId);
      }

      // If it's not end_call, or if we still need to send the output, resolve the function
      // (handleEndCall sends the output explicitly to ensure the socket isn't closed too early)
      if (name !== 'end_call') {
        const functionOutput = {
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: callId,
            output: JSON.stringify(result || { status: "completed" })
          }
        };
        this.sendToOpenAI(functionOutput);
        this.sendToOpenAI({ type: 'response.create' });
      }

    } catch (error) {
      logger.error(`Error executing function ${name}:`, error);
    }
  }

  async handleScheduleAppointment(args) {
      const { contactName, companyName, confirmedPhone, appointmentTime } = args;
      const leadData = {
          contactName,
          companyName,
          confirmedPhone,
          appointmentTime,
          callerId: this.callerId,
          timestamp: new Date().toISOString()
      };

      try {
          const leadsFile = path.resolve('src/data/leads.json');
          const data = await fs.readFile(leadsFile, 'utf8');
          const leads = JSON.parse(data);
          leads.push(leadData);
          await fs.writeFile(leadsFile, JSON.stringify(leads, null, 2));

          await sendSuccessEmail(leadData);
          logger.info(`Appointment scheduled and email sent for ${companyName}`);
      } catch (err) {
          logger.error('Error saving lead data', err);
      }
  }

  async handleReportInteraction(args) {
      const { reason, summary } = args;
      const reportData = {
          reason,
          summary,
          callerId: this.callerId,
          timestamp: new Date().toISOString()
      };

      try {
          const interactionsFile = path.resolve('src/data/interactions.json');
          const data = await fs.readFile(interactionsFile, 'utf8');
          const interactions = JSON.parse(data);
          interactions.push(reportData);
          await fs.writeFile(interactionsFile, JSON.stringify(interactions, null, 2));

          await sendReportEmail(reportData);
          logger.info(`Interaction reported and email sent for ${this.callerId}`);
      } catch (err) {
          logger.error('Error saving interaction data', err);
      }
  }

  handleEndCall(callId) {
      // First, we must resolve the tool call so the model doesn't hang
      const functionOutput = {
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: callId,
            output: JSON.stringify({ status: 'closing_connection' })
          }
      };
      this.sendToOpenAI(functionOutput);

      // Tell the AI to say goodbye
      this.sendToOpenAI({
        type: 'conversation.item.create',
        item: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Say a short, polite goodbye.' }]
        }
      });
      this.sendToOpenAI({ type: 'response.create' });

      logger.info(`Initiating 10-second delay before closing connection for ${this.callSid}`);

      // Wait 10 seconds before closing the websocket so the AI can finish speaking
      setTimeout(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
              logger.info(`Closing Twilio WebSocket for ${this.callSid}`);
              this.ws.close();
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
      this.callSid = data.start.callSid; // explicitly capture
      logger.info(`Stream started: ${this.streamSid} for CallSid: ${this.callSid}`);

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
