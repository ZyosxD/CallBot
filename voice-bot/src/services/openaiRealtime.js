import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';

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
        this.isOpenAiConnected = false;
      });

    } catch (error) {
      logger.error('Error connecting to OpenAI:', error);
    }
  }

  checkAndInitializeSession() {
    if (this.isOpenAiConnected && this.isTwilioStarted) {
      this.sendSessionUpdate();

      // Force OpenAI to speak first
      const initialGreeting = this.mode === 'inbound'
        ? "Hi, thanks for calling 1Wire! Are you the one handling the tech, or should I ask for the Office Manager?"
        : "Hi, this is Sarah from 1Wire! Are you the one handling the tech, or should I ask for the Office Manager?";

      this.sendToOpenAI({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'system',
          content: [
            {
              type: 'input_text',
              text: `Start the conversation immediately. Say exactly: "${initialGreeting}"`
            }
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
            description: "Schedule a Technical Assessment. Use this ONLY when the user says YES to an appointment.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the IT Manager/Owner" },
                companyName: { type: "string", description: "Name of the company" },
                confirmedPhone: { type: "string", description: "The verbally confirmed phone number" },
                appointmentTime: { type: "string", description: "The exact time for the appointment" },
                needs: { type: "string", description: "Any specific needs discussed (e.g. Fiber, VoIP)" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report an unsuccessful interaction (not interested, call back later, voicemail).",
            parameters: {
              type: "object",
              properties: {
                interactionType: { type: "string", enum: ["not_interested", "call_back_later", "voicemail", "other"] },
                details: { type: "string", description: "Brief details about the interaction" },
                confirmedPhone: { type: "string", description: "The verbally confirmed phone number, if available" }
              },
              required: ["interactionType", "details"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call conversation",
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
    let result = null;
    let parsedArgs = {};

    try {
      parsedArgs = JSON.parse(args);
      logger.info(`Function call detected: ${name} with args: ${args}`);

      if (name === 'schedule_appointment') {
        // Log to leads.json
        const leadsPath = path.resolve('src/data/leads.json');
        let leads = [];
        if (fs.existsSync(leadsPath)) {
          leads = JSON.parse(fs.readFileSync(leadsPath, 'utf8'));
        }
        leads.push({
          timestamp: new Date().toISOString(),
          callSid: this.callSid,
          callerId: this.callerId,
          ...parsedArgs
        });
        fs.writeFileSync(leadsPath, JSON.stringify(leads, null, 2));

        // Send Success Email
        await sendSuccessEmail(
          parsedArgs.contactName,
          parsedArgs.companyName,
          parsedArgs.confirmedPhone,
          this.callerId,
          parsedArgs.appointmentTime,
          parsedArgs.needs
        );
        result = { status: 'appointment_scheduled_successfully' };

      } else if (name === 'report_interaction') {
        // Log to interactions.json
        const interactionsPath = path.resolve('src/data/interactions.json');
        let interactions = [];
        if (fs.existsSync(interactionsPath)) {
          interactions = JSON.parse(fs.readFileSync(interactionsPath, 'utf8'));
        }
        interactions.push({
          timestamp: new Date().toISOString(),
          callSid: this.callSid,
          callerId: this.callerId,
          ...parsedArgs
        });
        fs.writeFileSync(interactionsPath, JSON.stringify(interactions, null, 2));

        // Send Report Email
        await sendReportEmail(
          parsedArgs.interactionType,
          parsedArgs.details,
          parsedArgs.confirmedPhone,
          this.callerId
        );
        result = { status: 'interaction_reported' };

      } else if (name === 'end_call') {
        logger.info(`Ending call ${this.callSid} in 10 seconds...`);

        // Force a polite goodbye right before ending
        this.sendToOpenAI({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'system',
            content: [
              {
                type: 'input_text',
                text: "Say a short, polite goodbye."
              }
            ]
          }
        });
        this.sendToOpenAI({ type: 'response.create' });

        result = { status: 'call_ending' };

        // Set 10s delay to close websocket
        setTimeout(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.close();
          }
        }, 10000);
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

      // DO NOT trigger response.create automatically after end_call as we explicitly did it above
      if (name !== 'end_call') {
         this.sendToOpenAI({ type: 'response.create' });
      }

    } catch (error) {
      logger.error(`Error executing function ${name}: `, error);
      // Resolve even on error to avoid AI hanging
      const functionOutput = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify({ error: "Function execution failed" })
        }
      };
      this.sendToOpenAI(functionOutput);
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