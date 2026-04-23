import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendEmailReport } from './emailService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class OpenAIRealtimeService {
  constructor(ws, callSid) {
    this.ws = ws;
    this.callSid = callSid;
    this.openaiWs = null;
    this.streamSid = null;
    this.callerId = null;
    this.mode = 'inbound';

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
            description: "Schedule a Technical Assessment. Use this ONLY after collecting The Trifecta (Contact Name, Company Name, Phone Verification) and the Exact Time.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the decision maker (IT Manager, Owner, etc.)" },
                companyName: { type: "string", description: "Name of the company" },
                confirmedPhone: { type: "string", description: "The phone number verbally confirmed by the contact as the best number to reach them." },
                appointmentTime: { type: "string", description: "The exact date and time agreed upon for the assessment." }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report the interaction if the client is not interested, asks to call back later, or if it is a voicemail.",
            parameters: {
              type: "object",
              properties: {
                summary: { type: "string", description: "Brief summary of what happened." }
              },
              required: ["summary"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call gracefully. Use this when the conversation has naturally concluded.",
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
      logger.error(`SyntaxError parsing function args for ${name}:`, e);
      return;
    }

    let result = null;

    try {
      if (name === 'schedule_appointment') {
        const clientInfo = {
          contactName: parsedArgs.contactName,
          companyName: parsedArgs.companyName,
          originalPhone: this.callerId,
          confirmedPhone: parsedArgs.confirmedPhone,
          appointmentTime: parsedArgs.appointmentTime
        };

        // Append to leads
        const leadsPath = path.join(__dirname, '../data/leads.json');
        const leads = fs.existsSync(leadsPath) ? JSON.parse(fs.readFileSync(leadsPath, 'utf8')) : [];
        leads.push(clientInfo);
        fs.writeFileSync(leadsPath, JSON.stringify(leads, null, 2));

        // Send Success Email
        await sendEmailReport({ isSuccess: true, clientInfo, summary: 'Scheduled Technical Assessment.' });
        result = { status: 'appointment_scheduled' };

      } else if (name === 'report_interaction') {
        const interactionData = {
          originalPhone: this.callerId,
          summary: parsedArgs.summary,
          timestamp: new Date().toISOString()
        };

        // Append to interactions
        const interactionsPath = path.join(__dirname, '../data/interactions.json');
        const interactions = fs.existsSync(interactionsPath) ? JSON.parse(fs.readFileSync(interactionsPath, 'utf8')) : [];
        interactions.push(interactionData);
        fs.writeFileSync(interactionsPath, JSON.stringify(interactions, null, 2));

        // Send Report Email
        await sendEmailReport({
          isSuccess: false,
          clientInfo: { originalPhone: this.callerId },
          summary: parsedArgs.summary
        });
        result = { status: 'interaction_reported' };

      } else if (name === 'end_call') {
        // Handle end call with a 10s delay to allow goodbye
        result = { status: 'ending_call' };

        // Send result immediately so OpenAI doesn't hang
        const functionOutput = {
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: callId,
            output: JSON.stringify(result)
          }
        };
        this.sendToOpenAI(functionOutput);

        // Send instruction to say goodbye
        this.sendToOpenAI({ type: 'response.create' });

        // Wait 10s then close websocket
        setTimeout(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.close();
          }
          if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
            this.openaiWs.close();
          }
        }, 10000);

        return; // Early return to avoid sending double output
      }

      // Send result back to OpenAI for tools other than end_call
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
      this.sendToOpenAI({ type: 'response.create' });

    } catch (error) {
      logger.error(`Error executing function ${name}:`, error);
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

      // Extract custom parameters
      if (data.start.customParameters) {
        this.callerId = data.start.customParameters.callerId || this.callerId;
        this.mode = data.start.customParameters.mode || 'inbound';
      }

      logger.info(`Stream started: ${this.streamSid}, CallerId: ${this.callerId}, Mode: ${this.mode}`);
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
