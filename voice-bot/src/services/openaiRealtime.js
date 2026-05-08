import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendNotificationEmail } from './emailService.js';
import fs from 'fs';
import path from 'path';

export class OpenAIRealtimeService {
  constructor(ws, callSid) {
    this.ws = ws;
    this.callSid = callSid;
    this.openaiWs = null;
    this.streamSid = null;
    this.callerId = 'unknown';
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
            description: "Schedule a Technical Assessment appointment for Internet, VoIP, or IT services. You MUST have collected the client's contactName, companyName, a verified confirmedPhone (crucial to distinguish landlines from mobile), and the appointmentTime before calling this tool.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the contact (e.g. IT Manager, Owner)" },
                companyName: { type: "string", description: "Name of the company" },
                confirmedPhone: { type: "string", description: "The verbally confirmed phone number to reach them at" },
                appointmentTime: { type: "string", description: "The exact date and time for the appointment" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Log the interaction when a client is not interested, asks to call back later, or reaches a voicemail.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Reason for the report (e.g. not interested, voicemail, call back later)" },
                notes: { type: "string", description: "Any additional notes about the interaction" }
              },
              required: ["reason"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "Politely end the conversation and close the connection.",
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
          logConversation(this.callSid, 'Sarah', event.transcript);
      }

      if (event.type === 'conversation.item.input_audio_transcription.completed') {
          logConversation(this.callSid, 'Client', event.transcript);
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
      logger.error(`Error parsing JSON arguments for tool ${name}: ${e.message}`);
      return;
    }

    let result = { status: "success" };

    try {
      if (name === 'schedule_appointment') {
        const { contactName, companyName, confirmedPhone, appointmentTime } = parsedArgs;

        // Save to leads.json
        const leadsPath = path.resolve('leads.json');
        let leads = [];
        if (fs.existsSync(leadsPath)) {
          leads = JSON.parse(fs.readFileSync(leadsPath, 'utf8'));
        }
        leads.push({
          contactName, companyName, confirmedPhone, appointmentTime,
          callerId: this.callerId, mode: this.mode, timestamp: new Date().toISOString()
        });
        fs.writeFileSync(leadsPath, JSON.stringify(leads, null, 2));

        // Send Success Email
        await sendNotificationEmail({
          type: 'success',
          contactName, companyName, confirmedPhone, appointmentTime,
          callerId: this.callerId
        });

        result = { status: "appointment_scheduled" };

      } else if (name === 'report_interaction') {
        const { reason, notes } = parsedArgs;

        // Save to interactions.json
        const interactionsPath = path.resolve('interactions.json');
        let interactions = [];
        if (fs.existsSync(interactionsPath)) {
          interactions = JSON.parse(fs.readFileSync(interactionsPath, 'utf8'));
        }
        interactions.push({
          reason, notes, callerId: this.callerId, mode: this.mode, timestamp: new Date().toISOString()
        });
        fs.writeFileSync(interactionsPath, JSON.stringify(interactions, null, 2));

        // Send Report Email
        await sendNotificationEmail({
          type: 'report',
          reason, notes,
          callerId: this.callerId
        });

        result = { status: "interaction_reported" };

      } else if (name === 'end_call') {
        // Handle end call
        result = { status: "ending_call" };

        // Send function output BEFORE ending to satisfy OpenAI
        const functionOutput = {
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: callId,
            output: JSON.stringify(result)
          }
        };
        this.sendToOpenAI(functionOutput);

        // Final response for goodbye
        this.sendToOpenAI({ type: 'response.create' });

        // Wait 10 seconds before closing
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
      this.sendToOpenAI({ type: 'response.create' });

    } catch (error) {
      logger.error(`Error executing function ${name}:`, error);
      // Send error back
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
