import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sendNotificationEmail } from './emailService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'data');

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
        instructions: prompts.systemInstruction,
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Schedule a Technical Assessment after gathering all mandatory information (The Trifecta).",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the person handling technology (IT Manager/Owner)." },
                companyName: { type: "string", description: "Name of the company." },
                confirmedPhone: { type: "string", description: "The confirmed phone number." },
                appointmentTime: { type: "string", description: "The exact requested time for the appointment." },
                notes: { type: "string", description: "Any additional notes or needs mentioned." }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report when the client is not interested, asks to call back later, or if reaching a voicemail.",
            parameters: {
              type: "object",
              properties: {
                outcome: { type: "string", description: "Detailed reason or outcome (e.g., 'Not interested', 'Voicemail', 'Call back tomorrow')." }
              },
              required: ["outcome"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "Ends the current call gracefully. Use only when the conversation is completely finished.",
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
    let parsedArgs = {};

    try {
        parsedArgs = JSON.parse(args);
    } catch(e) {
        logger.error(`Error parsing JSON arguments for function ${name}: ${e.message}`);
    }

    logger.info(`Function call detected: ${name} with args: ${args}`);
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

      // Trigger a response generation if not ending the call, otherwise end_call handles the final goodbye
      if (name !== 'end_call') {
        this.sendToOpenAI({ type: 'response.create' });
      }

    } catch (error) {
      logger.error(`Error executing function ${name}:`, error);
    }
  }

  async executeScheduleAppointment(data) {
      const entry = {
          timestamp: new Date().toISOString(),
          callSid: this.callSid,
          callerId: this.callerId,
          mode: this.mode,
          ...data
      };

      const leadsPath = path.join(DATA_DIR, 'leads.json');
      let leads = [];
      try {
          if (fs.existsSync(leadsPath)) {
              leads = JSON.parse(fs.readFileSync(leadsPath, 'utf8'));
          }
      } catch (e) {
          logger.error('Error reading leads.json:', e);
      }
      leads.push(entry);
      fs.writeFileSync(leadsPath, JSON.stringify(leads, null, 2));

      await sendNotificationEmail('SUCCESS', entry);
      return { status: "Appointment scheduled successfully." };
  }

  async executeReportInteraction(data) {
      const entry = {
          timestamp: new Date().toISOString(),
          callSid: this.callSid,
          callerId: this.callerId,
          mode: this.mode,
          ...data
      };

      const interactionsPath = path.join(DATA_DIR, 'interactions.json');
      let interactions = [];
      try {
          if (fs.existsSync(interactionsPath)) {
              interactions = JSON.parse(fs.readFileSync(interactionsPath, 'utf8'));
          }
      } catch (e) {
          logger.error('Error reading interactions.json:', e);
      }
      interactions.push(entry);
      fs.writeFileSync(interactionsPath, JSON.stringify(interactions, null, 2));

      await sendNotificationEmail('REPORT', entry);
      return { status: "Interaction logged successfully." };
  }

  async executeEndCall() {
      logger.info(`Initiating end_call sequence for CallSid: ${this.callSid}`);

      // Trigger a final response to say goodbye
      this.sendToOpenAI({ type: 'response.create' });

      // Delay 10 seconds before closing socket
      setTimeout(() => {
          logger.info(`Closing sockets after 10s delay for CallSid: ${this.callSid}`);
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
              this.ws.close();
          }
          if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
              this.openaiWs.close();
          }
      }, 10000);

      return { status: "Ending call in 10 seconds..." };
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
      this.callSid = data.start.callSid || this.callSid;

      // Get custom parameters passed from TwiML
      if (data.start.customParameters) {
          this.callerId = data.start.customParameters.callerId || this.callerId;
          this.mode = data.start.customParameters.mode || this.mode;
      }

      logger.info(`Stream started: ${this.streamSid} | CallSid: ${this.callSid} | Mode: ${this.mode}`);
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
