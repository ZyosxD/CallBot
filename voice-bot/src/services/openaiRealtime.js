import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import twilio from 'twilio';
import fs from 'fs';
import path from 'path';

export class OpenAIRealtimeService {
  constructor(ws, callSid, callerId = 'unknown', mode = 'inbound') {
    this.ws = ws;
    this.callSid = callSid;
    this.callerId = callerId;
    this.mode = mode;
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
      this.sendSessionUpdate();
      this.sendInitialGreeting();
    }
  }

  sendInitialGreeting() {
    this.sendToOpenAI({
      type: 'response.create',
      response: {
        instructions: 'Start the conversation immediately. Introduce yourself briefly.'
      }
    });
  }

  sendSessionUpdate() {
    const promptInstructions = this.mode === 'outbound' ? prompts.SARAH_OUTBOUND : prompts.SARAH_INBOUND;

    const sessionUpdate = {
      type: 'session.update',
      session: {
        turn_detection: { type: 'server_vad', silence_duration_ms: 1500 },
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        voice: 'coral',
        instructions: promptInstructions,
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Schedule a technical assessment after getting the Trifecta: Contact Name, Company Name, Confirmed Phone, and Exact Time.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the person handling IT/Owner" },
                companyName: { type: "string", description: "Name of the company" },
                confirmedPhone: { type: "string", description: "The confirmed phone number" },
                appointmentTime: { type: "string", description: "The agreed exact time" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Log the call interaction when the client is not interested, asks to call back later, or it goes to voicemail.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Reason: not interested, voicemail, call back later" },
                notes: { type: "string", description: "Any additional notes from the call" }
              },
              required: ["reason"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call appropriately at the end of the conversation.",
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
    let result = null;

    logger.info(`Function call detected: ${name} with args: ${args}`);

    try {
      parsedArgs = JSON.parse(args);
    } catch (e) {
      logger.error(`Error parsing JSON for function ${name}:`, e);
      result = { error: 'Invalid arguments format' };
    }

    if (!result) {
      try {
        if (name === 'schedule_appointment') {
          await this.saveData('leads.json', { callerId: this.callerId, callSid: this.callSid, ...parsedArgs });
          const { sendSuccessEmail } = await import('./emailService.js');
          sendSuccessEmail(this.callerId, parsedArgs);
          result = { success: true };
        } else if (name === 'report_interaction') {
          await this.saveData('interactions.json', { callerId: this.callerId, callSid: this.callSid, ...parsedArgs });
          const { sendReportEmail } = await import('./emailService.js');
          sendReportEmail(this.callerId, parsedArgs);
          result = { success: true };
        } else if (name === 'end_call') {
          result = { status: 'ending' };

          this.sendToOpenAI({
            type: 'response.create',
            response: {
              instructions: 'Say a short, polite goodbye.'
            }
          });

          setTimeout(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.close();
            }
            if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
                this.openaiWs.close();
            }
          }, 10000);
        }

      } catch (error) {
        logger.error(`Error executing function ${name}:`, error);
        result = { error: error.message };
      }
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

    // Trigger a response generation
    if (name !== 'end_call') {
      this.sendToOpenAI({ type: 'response.create' });
    }
  }

  async saveData(filename, data) {
    const dataDir = path.join(process.cwd(), 'src', 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const filePath = path.join(dataDir, filename);
    let currentData = [];
    if (fs.existsSync(filePath)) {
      currentData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
    currentData.push({ timestamp: new Date().toISOString(), ...data });
    fs.writeFileSync(filePath, JSON.stringify(currentData, null, 2));
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
