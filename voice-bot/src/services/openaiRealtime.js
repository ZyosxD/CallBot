import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const leadsFilePath = path.join(__dirname, '../data/leads.json');
const interactionsFilePath = path.join(__dirname, '../data/interactions.json');

export class OpenAIRealtimeService {
  constructor(ws, callSid, mode = 'inbound', callerId = 'unknown') {
    this.ws = ws;
    this.callSid = callSid;
    this.mode = mode;
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
      logger.info('Both OpenAI and Twilio are connected. Initializing session...');
      this.sendSessionUpdate();

      // Start the conversation immediately
      const greeting = this.mode === 'outbound'
        ? "Hi, do you handle the technology or should I ask for an Office Manager?"
        : "Hello, thank you for calling 1Wire. How can I help you today?";

      this.sendToOpenAI({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: `Please start the conversation immediately by saying: "${greeting}"` }
          ]
        }
      });
      this.sendToOpenAI({ type: 'response.create' });
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
            description: "Schedule a Technical Assessment. MUST collect contactName, companyName, confirmedPhone, and appointmentTime before calling.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the person (IT Manager/Owner)" },
                companyName: { type: "string", description: "Name of the company" },
                confirmedPhone: { type: "string", description: "Best phone number to call back" },
                appointmentTime: { type: "string", description: "Date and exact time for the appointment" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report when the client is not interested, asks to call back later, or reaches a voicemail.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Reason for no appointment (e.g., 'Not interested', 'Voicemail')" },
                summary: { type: "string", description: "Brief summary of the interaction" }
              },
              required: ["reason", "summary"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call gracefully. Call this tool when the conversation is completely finished.",
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
    } catch (e) {
      logger.error(`SyntaxError parsing JSON for tool ${name}:`, e);
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

      // Send result back to OpenAI to resolve the function call block
      const functionOutput = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify(result)
        }
      };
      this.sendToOpenAI(functionOutput);

      // Optionally prompt AI to acknowledge if it isn't an end_call
      if (name !== 'end_call') {
        this.sendToOpenAI({ type: 'response.create' });
      }

    } catch (error) {
      logger.error(`Error executing function ${name}:`, error);
    }
  }

  async executeScheduleAppointment(data) {
    try {
      let leads = [];
      if (fs.existsSync(leadsFilePath)) {
        leads = JSON.parse(fs.readFileSync(leadsFilePath, 'utf8'));
      }

      leads.push({
        id: new Date().getTime().toString(),
        callSid: this.callSid,
        callerId: this.callerId,
        timestamp: new Date().toISOString(),
        ...data
      });
      fs.writeFileSync(leadsFilePath, JSON.stringify(leads, null, 2));

      await sendSuccessEmail(data, this.callerId);
      return { status: 'success', message: 'Appointment scheduled and email sent.' };
    } catch (e) {
      logger.error('Error scheduling appointment:', e);
      return { status: 'error', message: e.message };
    }
  }

  async executeReportInteraction(data) {
    try {
      let interactions = [];
      if (fs.existsSync(interactionsFilePath)) {
        interactions = JSON.parse(fs.readFileSync(interactionsFilePath, 'utf8'));
      }

      interactions.push({
        id: new Date().getTime().toString(),
        callSid: this.callSid,
        callerId: this.callerId,
        timestamp: new Date().toISOString(),
        ...data
      });
      fs.writeFileSync(interactionsFilePath, JSON.stringify(interactions, null, 2));

      await sendReportEmail(data, this.callerId);
      return { status: 'success', message: 'Interaction reported and email sent.' };
    } catch (e) {
      logger.error('Error reporting interaction:', e);
      return { status: 'error', message: e.message };
    }
  }

  async executeEndCall() {
    logger.info(`Ending call ${this.callSid} in 10 seconds...`);

    // Have the AI say goodbye
    this.sendToOpenAI({
      type: 'response.create',
      response: {
        instructions: "Say a short, polite goodbye right now."
      }
    });

    setTimeout(() => {
      logger.info(`Force closing websocket for call ${this.callSid}`);
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.close();
      }
    }, 10000);

    return { status: 'ending', message: 'Call will disconnect in 10 seconds.' };
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
      this.callSid = data.start.callSid; // explicitly update callSid inside handler to track correctly
      logger.info(`Stream started: ${this.streamSid} for call ${this.callSid}`);
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
