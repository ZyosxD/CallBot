import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';

export class OpenAIRealtimeService {
  constructor(ws) {
    this.ws = ws;
    this.callSid = null;
    this.callerId = null;
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
      });

    } catch (error) {
      logger.error('Error connecting to OpenAI:', error);
    }
  }

  handleTwilioStart(data) {
    this.streamSid = data.start.streamSid;
    logger.info(`Stream started: ${this.streamSid}`);
    this.isTwilioStarted = true;
    this.checkAndInitializeSession();
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
            description: "Schedule a Technical Assessment appointment. MUST be called only after collecting Contact Name, Company Name, Verified Phone, and Exact Time.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the person (IT Manager/Owner)" },
                companyName: { type: "string", description: "Name of the company" },
                confirmedPhone: { type: "string", description: "The phone number verbally confirmed by the user" },
                appointmentTime: { type: "string", description: "Exact time for the appointment" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Log the interaction if the client is not interested, asks to call back later, or if it goes to voicemail.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Reason for the report (e.g., Not interested, Call back later, Voicemail)" },
                summary: { type: "string", description: "Brief summary of the interaction" }
              },
              required: ["reason", "summary"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call after the conversation is complete (either after scheduling an appointment or reporting an interaction).",
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
        logger.error('Failed to parse function arguments:', e);
        // Continue with empty args to prevent unhandled rejection crash
    }

    let result = null;

    try {
      if (name === 'schedule_appointment') {
        const lead = {
          contactName: parsedArgs.contactName,
          companyName: parsedArgs.companyName,
          confirmedPhone: parsedArgs.confirmedPhone,
          callerId: this.callerId,
          appointmentTime: parsedArgs.appointmentTime,
          timestamp: new Date().toISOString()
        };

        const leadsFile = path.resolve('src/data/leads.json');
        const leads = JSON.parse(fs.readFileSync(leadsFile, 'utf8'));
        leads.push(lead);
        fs.writeFileSync(leadsFile, JSON.stringify(leads, null, 2));

        await sendSuccessEmail(lead.contactName, lead.companyName, lead.confirmedPhone, lead.callerId, lead.appointmentTime);
        result = { status: 'appointment_scheduled' };

      } else if (name === 'report_interaction') {
        const interaction = {
          callerId: this.callerId,
          reason: parsedArgs.reason,
          summary: parsedArgs.summary,
          timestamp: new Date().toISOString()
        };

        const interactionsFile = path.resolve('src/data/interactions.json');
        const interactions = JSON.parse(fs.readFileSync(interactionsFile, 'utf8'));
        interactions.push(interaction);
        fs.writeFileSync(interactionsFile, JSON.stringify(interactions, null, 2));

        await sendReportEmail(interaction.callerId, interaction.reason, interaction.summary);
        result = { status: 'interaction_logged' };

      } else if (name === 'end_call') {
        result = { status: 'ending_call' };

        // We must reply to the tool call first to resolve it
        const functionOutput = {
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: callId,
            output: JSON.stringify(result)
          }
        };
        this.sendToOpenAI(functionOutput);

        // Force a polite goodbye response
        this.sendToOpenAI({ type: 'response.create' });

        // Wait 10 seconds before hanging up
        setTimeout(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
              this.ws.close();
          }
        }, 10000);
        return; // Don't run the standard tool reply below since we already handled it
      }

      // Send result back to OpenAI for normal tools
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
    const audioAppend = {
        type: 'input_audio_buffer.append',
        audio: data.media.payload
    };
    this.sendToOpenAI(audioAppend);
  }
}