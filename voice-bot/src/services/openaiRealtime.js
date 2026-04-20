import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';

// Paths for Data Collection
const LEADS_FILE = path.join(process.cwd(), 'src', 'data', 'leads.json');
const INTERACTIONS_FILE = path.join(process.cwd(), 'src', 'data', 'interactions.json');

const writeDataToFile = (file, data) => {
    try {
        let currentData = [];
        if (fs.existsSync(file)) {
            currentData = JSON.parse(fs.readFileSync(file, 'utf8'));
        }
        currentData.push(data);
        fs.writeFileSync(file, JSON.stringify(currentData, null, 2));
    } catch (err) {
        logger.error(`Error writing to ${file}:`, err);
    }
}

export class OpenAIRealtimeService {
  constructor(ws, callSid, callerId = 'unknown', mode = 'inbound') {
    this.ws = ws;
    this.callSid = callSid;
    this.callerId = callerId;
    this.mode = mode;
    this.openaiWs = null;
    this.streamSid = null;

    // Safety checks for session initialization race conditions
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
            description: "Use this when the customer says YES to a technical assessment and you have collected all required information.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the person (IT Manager/Owner)" },
                companyName: { type: "string", description: "Name of the company" },
                confirmedPhone: { type: "string", description: "The verbally confirmed phone number" },
                appointmentTime: { type: "string", description: "The exact time for the appointment" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Use this when the customer is not interested, asks to call back later, or you reach a voicemail.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Reason for reporting (e.g., Not interested, Voicemail, Call later)" },
                details: { type: "string", description: "Any extra details gathered" }
              },
              required: ["reason"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "Use this to politely end the call.",
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

    // Initial greeting trigger
    this.sendToOpenAI({
        type: 'response.create',
        response: {
            instructions: "Start the conversation immediately. Introduce yourself briefly and ask: 'Do you handle the technology or should I ask for an Office Manager?'"
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
    const { name, arguments: args, call_id: callId } = event;

    let parsedArgs;
    try {
        parsedArgs = JSON.parse(args);
    } catch (err) {
        logger.error(`Error parsing JSON arguments for function ${name}:`, err);
        return;
    }

    logger.info(`Function call detected: ${name} with args: ${args}`);
    let result = null;

    try {
      if (name === 'schedule_appointment') {
        const payload = { ...parsedArgs, callerId: this.callerId, callSid: this.callSid, timestamp: new Date().toISOString() };
        writeDataToFile(LEADS_FILE, payload);

        // Dynamic import to break circular deps / keep it lightweight
        const { sendEmail } = await import('./emailService.js');
        await sendEmail('success', payload);

        result = { status: 'Appointment scheduled successfully. The human agent will call them.' };
      } else if (name === 'report_interaction') {
        const payload = { ...parsedArgs, callerId: this.callerId, callSid: this.callSid, timestamp: new Date().toISOString() };
        writeDataToFile(INTERACTIONS_FILE, payload);

        const { sendEmail } = await import('./emailService.js');
        await sendEmail('report', payload);

        result = { status: 'Interaction reported successfully.' };
      } else if (name === 'end_call') {
        result = { status: 'Ending call in 10 seconds...' };

        // Send function call output immediately so AI doesn't hang
        this.sendFunctionOutput(callId, result);

        // Tell AI to say goodbye
        this.sendToOpenAI({
            type: 'response.create',
            response: {
                instructions: "Say a short, polite goodbye."
            }
        });

        // 10 second delay before closing socket
        setTimeout(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.close();
            }
        }, 10000);
        return; // Early return since we handled the function output manually
      }

      this.sendFunctionOutput(callId, result);

      if (name !== 'end_call') {
          // Trigger a response generation so AI acknowledges the tool success
          this.sendToOpenAI({ type: 'response.create' });
      }

    } catch (error) {
      logger.error(`Error executing function ${name}:`, error);
      this.sendFunctionOutput(callId, { error: 'Failed to execute function.' });
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
