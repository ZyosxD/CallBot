import fs from 'fs';
import path from 'path';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger from '../utils/logger.js';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';
import { markCallEnded } from './dripService.js';

const leadsFile = path.resolve('src/data/leads.json');
const interactionsFile = path.resolve('src/data/interactions.json');

export class OpenAIRealtimeService {
  constructor(ws, callSid, callerId, mode) {
    this.ws = ws;
    this.callSid = callSid;
    this.callerId = callerId;
    this.mode = mode; // 'inbound' or 'outbound'
    this.openaiWs = null;
    this.streamSid = null;
    this.isOpenAiConnected = false;
    this.isTwilioStarted = false;
    this.sessionInitialized = false;
  }

  async connect() {
    try {
      // Dynamic import to handle ES module
      const WebSocket = (await import('ws')).default;

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
        instructions: prompts.systemInstruction + '\n\n' + prompts.schedule_appointment_instructions + '\n\n' + prompts.report_interaction_instructions,
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Trigger this when you have successfully collected the Contact Name, Company Name, Phone Verification, and Exact Time for a Technical Assessment.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string" },
                companyName: { type: "string" },
                confirmedPhone: { type: "string" },
                appointmentTime: { type: "string" },
                notes: { type: "string" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Trigger this if the client is not interested, asks to call back later, or you reach a voicemail.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string" },
                reason: { type: "string", enum: ["not_interested", "call_back_later", "voicemail", "other"] },
                notes: { type: "string" }
              },
              required: ["reason"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the current call after finishing the conversation.",
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

    logger.info(`Function call detected: ${name}`);
    let result = null;

    try {
      const parsedArgs = JSON.parse(args);

      if (name === 'schedule_appointment') {
        result = await this.scheduleAppointment(parsedArgs);
      } else if (name === 'report_interaction') {
        result = await this.reportInteraction(parsedArgs);
      } else if (name === 'end_call') {
        result = await this.endCall();
      }

      const functionOutput = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify(result || { status: 'success' })
        }
      };
      this.sendToOpenAI(functionOutput);
      this.sendToOpenAI({ type: 'response.create' });

    } catch (error) {
      logger.error(`Error executing function ${name}:`, error);
      const functionOutput = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify({ error: error.message })
        }
      };
      this.sendToOpenAI(functionOutput);
      this.sendToOpenAI({ type: 'response.create' });
    }
  }

  async scheduleAppointment(details) {
    logger.info(`Scheduling appointment for ${details.companyName}`);
    const data = { ...details, callerId: this.callerId, timestamp: new Date().toISOString() };

    // Save to leads.json
    let leads = [];
    if (fs.existsSync(leadsFile)) {
      leads = JSON.parse(fs.readFileSync(leadsFile, 'utf8'));
    }
    leads.push(data);
    fs.writeFileSync(leadsFile, JSON.stringify(leads, null, 2));

    await sendSuccessEmail(data);
    return { status: 'success', message: 'Appointment scheduled successfully. Tell the user you have confirmed it.' };
  }

  async reportInteraction(details) {
    logger.info(`Reporting interaction: ${details.reason}`);
    const data = { ...details, callerId: this.callerId, timestamp: new Date().toISOString() };

    // Save to interactions.json
    let interactions = [];
    if (fs.existsSync(interactionsFile)) {
      interactions = JSON.parse(fs.readFileSync(interactionsFile, 'utf8'));
    }
    interactions.push(data);
    fs.writeFileSync(interactionsFile, JSON.stringify(interactions, null, 2));

    await sendReportEmail(data);
    return { status: 'success', message: 'Interaction reported.' };
  }

  async endCall() {
    logger.info('Ending call gracefully in 10 seconds...');

    // Ask the bot to say goodbye
    this.sendToOpenAI({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Please say a polite, short goodbye.' }]
      }
    });
    this.sendToOpenAI({ type: 'response.create' });

    setTimeout(() => {
      if (this.ws && this.ws.readyState === 1) { // 1 = OPEN
        this.ws.close();
      }
      if (this.openaiWs && this.openaiWs.readyState === 1) {
        this.openaiWs.close();
      }
      markCallEnded(this.callSid);
    }, 10000);

    return { status: 'closing' };
  }

  sendAudioToTwilio(audioPayload) {
    if (this.ws && this.ws.readyState === 1 && this.streamSid) { // 1 = OPEN
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
    if (this.openaiWs && this.openaiWs.readyState === 1) { // 1 = OPEN
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
    } else if (data.event === 'stop') {
      logger.info(`Stream stopped for call ${this.callSid}`);
      markCallEnded(this.callSid);
      if (this.openaiWs && this.openaiWs.readyState === 1) {
        this.openaiWs.close();
      }
    }
  }
}
