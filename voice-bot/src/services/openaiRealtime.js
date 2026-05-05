import WebSocket from 'ws';
import fs from 'fs/promises';
import path from 'path';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import twilio from 'twilio';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';
import { markCallEnded } from './dripService.js';

export class OpenAIRealtimeService {
  constructor(ws, callSid, callerId, mode) {
    this.ws = ws;
    this.callSid = callSid;
    this.callerId = callerId;
    this.mode = mode || 'inbound';
    this.openaiWs = null;
    this.streamSid = null;
    this.isOpenAiConnected = false;
    this.isTwilioStarted = false;
    this.sessionUpdateSent = false;
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
      if (this.isOpenAiConnected && this.isTwilioStarted && !this.sessionUpdateSent) {
          this.sendSessionUpdate();
          this.sessionUpdateSent = true;
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
            description: "Schedule a Technical Assessment. Required: contactName, companyName, confirmedPhone, appointmentTime.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string" },
                companyName: { type: "string" },
                confirmedPhone: { type: "string" },
                appointmentTime: { type: "string", description: "Exact time requested for tomorrow" },
                needsDetected: { type: "string", description: "Short summary of their needs" },
                notes: { type: "string", description: "Any extra notes" }
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
                status: { type: "string", enum: ["NOT_INTERESTED", "CALL_BACK_LATER", "VOICEMAIL"] },
                reason: { type: "string" },
                companyName: { type: "string" },
                contactName: { type: "string" },
                confirmedPhone: { type: "string" },
                notes: { type: "string" }
              },
              required: ["status", "reason"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call gracefully. Call this tool when the conversation is finished.",
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
    } catch (error) {
        logger.error(`Error parsing JSON arguments for ${name}: ${args}`, error);
        return; // Early return on invalid JSON to avoid crashes
    }

    logger.info(`Function call detected: ${name} with args: ${args}`);
    let result = null;

    try {
      if (name === 'schedule_appointment') {
          const leadData = {
              ...parsedArgs,
              callerId: this.callerId,
              timestamp: new Date().toISOString()
          };

          // Save to leads.json
          const leadsPath = path.join(process.cwd(), 'src', 'data', 'leads.json');
          const data = await fs.readFile(leadsPath, 'utf8');
          const leads = JSON.parse(data);
          leads.push(leadData);
          await fs.writeFile(leadsPath, JSON.stringify(leads, null, 2), 'utf8');

          // Send email
          await sendSuccessEmail(leadData);

          result = { status: 'success', message: 'Appointment scheduled and email sent.' };

      } else if (name === 'report_interaction') {
          const interactionData = {
              ...parsedArgs,
              callerId: this.callerId,
              timestamp: new Date().toISOString()
          };

          // Save to interactions.json
          const interactionsPath = path.join(process.cwd(), 'src', 'data', 'interactions.json');
          const data = await fs.readFile(interactionsPath, 'utf8');
          const interactions = JSON.parse(data);
          interactions.push(interactionData);
          await fs.writeFile(interactionsPath, JSON.stringify(interactions, null, 2), 'utf8');

          // Send email
          await sendReportEmail(interactionData);

          result = { status: 'success', message: 'Interaction reported.' };

      } else if (name === 'end_call') {
          logger.info(`Initiating end_call for ${this.callSid}`);

          // Respond back to tool call immediately to avoid hang
          const functionOutput = {
            type: 'conversation.item.create',
            item: {
              type: 'function_call_output',
              call_id: callId,
              output: JSON.stringify({ status: 'ending' })
            }
          };
          this.sendToOpenAI(functionOutput);

          this.sendToOpenAI({ type: 'response.create' });

          setTimeout(() => {
              if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                  this.ws.close();
              }
              if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
                  this.openaiWs.close();
              }
              // Forcefully release the dialing lock dynamically using the service
              markCallEnded(this.callSid);
          }, 10000); // 10 second delay

          return; // Skip normal output sending
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
