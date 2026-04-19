import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendReportEmail, generateEmailSubject, generateEmailBody } from './emailService.js';

const leadsFile = path.resolve('src/data/leads.json');
const interactionsFile = path.resolve('src/data/interactions.json');

export class OpenAIRealtimeService {
  constructor(ws, callSid) {
    this.ws = ws;
    this.callSid = callSid;
    this.openaiWs = null;
    this.streamSid = null;
    this.mode = 'inbound';
    this.callerId = 'unknown';

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
            description: "Triggers when a Technical Assessment is successfully scheduled. MUST be called ONLY after collecting the Trifecta: Contact Name, Company Name, Confirmed Phone, and Exact Time.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Who are we asking for?" },
                companyName: { type: "string", description: "Company name to check the fiber map." },
                confirmedPhone: { type: "string", description: "The best phone number to call back." },
                appointmentTime: { type: "string", description: "Exact time for the appointment tomorrow." },
                notes: { type: "string", description: "Any additional notes or pain points." }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Triggers when the client is not interested, asks to call back later, or it is a voicemail.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Why wasn't the appointment scheduled? (e.g., Not interested, Call back later, Voicemail)" },
                notes: { type: "string", description: "Details of the interaction." }
              },
              required: ["reason"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "Triggers when the conversation is completely over and the agent should say goodbye and hang up.",
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

    // Force AI to speak first
    setTimeout(() => {
        const greetingPrompt = this.mode === 'outbound' ?
            "Start the conversation immediately. Say: 'Hi, this is Sarah from 1Wire. Do you handle the technology, or should I ask for an Office Manager?'" :
            "Start the conversation immediately. Say: 'Hi, thank you for calling 1Wire, this is Sarah. How can I help you today?'";

        this.sendToOpenAI({
            type: 'conversation.item.create',
            item: {
                type: 'message',
                role: 'user',
                content: [{ type: 'input_text', text: greetingPrompt }]
            }
        });
        this.sendToOpenAI({ type: 'response.create' });
    }, 500);
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
        logger.error(`Error parsing JSON arguments for tool ${name}:`, error);
        return;
    }

    let result = null;

    try {
      if (name === 'schedule_appointment') {
          this.saveData(leadsFile, { callerId: this.callerId, mode: this.mode, ...parsedArgs });

          const subject = generateEmailSubject(true);
          const body = generateEmailBody(this.callerId, parsedArgs.confirmedPhone, parsedArgs, true);
          await sendReportEmail(subject, body);

          result = { status: "success", message: "Appointment scheduled and saved." };

      } else if (name === 'report_interaction') {
          this.saveData(interactionsFile, { callerId: this.callerId, mode: this.mode, ...parsedArgs });

          const subject = generateEmailSubject(false);
          const body = generateEmailBody(this.callerId, null, parsedArgs, false);
          await sendReportEmail(subject, body);

          result = { status: "success", message: "Interaction reported." };

      } else if (name === 'end_call') {
          result = { status: "success", message: "Initiating disconnect sequence in 10 seconds." };

          // Must return result before closing
          this.sendFunctionOutput(callId, result);

          // Request AI to say a short goodbye before hanging up
          this.sendToOpenAI({
             type: 'conversation.item.create',
             item: {
                 type: 'message',
                 role: 'user',
                 content: [{ type: 'input_text', text: "Say a short, polite goodbye." }]
             }
          });
          this.sendToOpenAI({ type: 'response.create' });

          setTimeout(() => {
              logger.info(`Closing connections for call ${this.callSid} after end_call tool.`);
              if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                  this.ws.close();
              }
          }, 10000);

          return; // Skip standard response send
      }

      this.sendFunctionOutput(callId, result);
      this.sendToOpenAI({ type: 'response.create' });

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

  saveData(filePath, data) {
      try {
          let currentData = [];
          if (fs.existsSync(filePath)) {
              currentData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          }
          currentData.push({ timestamp: new Date().toISOString(), ...data });
          fs.writeFileSync(filePath, JSON.stringify(currentData, null, 2), 'utf-8');
      } catch (error) {
          logger.error(`Error saving data to ${filePath}:`, error);
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
