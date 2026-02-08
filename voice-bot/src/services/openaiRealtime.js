import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import * as leadService from './leadService.js';
import { sendSuccessEmail, sendReportEmail } from '../utils/mailer.js';
import eventBus from '../utils/events.js';
import twilio from 'twilio';

export class OpenAIRealtimeService {
  constructor(ws, callSid, callDetails = {}) {
    this.ws = ws;
    this.callSid = callSid;
    this.callDetails = callDetails; // { clientId, direction, ... }
    this.openaiWs = null;
    this.streamSid = null;
    this.isCallEnded = false;
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
        this.sendSessionUpdate();
      });

      this.openaiWs.on('message', (data) => {
        this.handleOpenAIMessage(data);
      });

      this.openaiWs.on('error', (error) => {
        logger.error('OpenAI WebSocket Error:', error);
      });

      this.openaiWs.on('close', () => {
        logger.info('OpenAI WebSocket Closed');
        this.emitCallEnd();
      });

    } catch (error) {
      logger.error('Error connecting to OpenAI:', error);
      this.emitCallEnd();
    }
  }

  emitCallEnd() {
    if (!this.isCallEnded) {
        this.isCallEnded = true;
        eventBus.emit('callEnded', { callSid: this.callSid });
    }
  }

  sendSessionUpdate() {
    const direction = this.callDetails.direction || 'outbound';
    const instructions = direction === 'inbound' ? prompts.inbound : prompts.outbound;

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
            description: "Schedule a Technical Assessment. Use ONLY when you have Name, Company, Verified Phone, and Time.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the person" },
                companyName: { type: "string", description: "Name of the company" },
                confirmedPhone: { type: "string", description: "Verified phone number" },
                appointmentTime: { type: "string", description: "Preferred date/time for the call" },
                notes: { type: "string", description: "Any additional notes" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report the outcome of the call if no appointment was scheduled (e.g. Not Interested, Call Later, Voicemail).",
            parameters: {
              type: "object",
              properties: {
                outcome: { type: "string", enum: ["NOT_INTERESTED", "CALL_LATER", "VOICEMAIL", "WRONG_NUMBER", "OTHER"] },
                notes: { type: "string", description: "Details about the interaction" }
              },
              required: ["outcome"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call gracefully when the conversation is over.",
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
    const parsedArgs = JSON.parse(args);
    const callId = event.call_id;

    logger.info(`Function call detected: ${name} with args: ${args}`);
    let result = { status: 'success' };

    try {
      if (name === 'schedule_appointment') {
        // Save lead
        const leadData = {
            ...parsedArgs,
            originalPhone: this.callDetails.phoneNumber,
            callSid: this.callSid
        };
        await leadService.addLead(leadData);
        if (this.callDetails.clientId) {
            await leadService.updateClientStatus(this.callDetails.clientId, 'APPOINTMENT');
        }

        // Send Email
        await sendSuccessEmail({
            ...parsedArgs,
            callerId: this.callDetails.phoneNumber
        });

        result = { message: "Appointment scheduled and email sent." };

      } else if (name === 'report_interaction') {
        // Log interaction
        const interactionData = {
            ...parsedArgs,
            phone: this.callDetails.phoneNumber,
            callSid: this.callSid
        };
        await leadService.logInteraction(interactionData);
         if (this.callDetails.clientId) {
            // Map outcome to status if needed, or just keep as CALLED or update specific
            // e.g., if NOT_INTERESTED -> CLOSED_LOST
            let newStatus = 'CALLED';
            if (parsedArgs.outcome === 'NOT_INTERESTED') newStatus = 'NOT_INTERESTED';
            if (parsedArgs.outcome === 'VOICEMAIL') newStatus = 'VOICEMAIL';

            await leadService.updateClientStatus(this.callDetails.clientId, newStatus);
        }

        // Send Email
        await sendReportEmail({
            phone: this.callDetails.phoneNumber,
            outcome: parsedArgs.outcome,
            notes: parsedArgs.notes
        });

        result = { message: "Interaction reported." };

      } else if (name === 'end_call') {
        logger.info('Ending call as requested by model.');
        // Trigger the 10s delay termination
        setTimeout(() => {
            logger.info('Closing connection now (10s delay passed).');
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.close();
            }
            if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
                this.openaiWs.close();
            }
        }, 10000); // 10 seconds

        result = { message: "Call will end in 10 seconds. Say goodbye." };
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

      // Trigger a response generation (so it can speak "Goodbye" or confirm)
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
      this.callSid = data.start.callSid; // Update CallSid from stream start event
      // Extract caller number if available in customParameters?
      // Usually passed in query params of the websocket url, handled in controller.
      logger.info(`Stream started: ${this.streamSid}`);
    } else if (data.event === 'media') {
        const audioAppend = {
            type: 'input_audio_buffer.append',
            audio: data.media.payload
        };
        this.sendToOpenAI(audioAppend);
    } else if (data.event === 'stop') {
        logger.info(`Stream stopped for call ${this.callSid}`);
        this.emitCallEnd();
    }
  }
}
