import WebSocket from 'ws';
import { config } from '../config/config.js';
import { getSystemPrompt } from '../config/prompts.js';
import * as leadService from './leadService.js';
import * as mailer from '../utils/mailer.js';
import logger from '../utils/logger.js';
import eventBus from '../utils/events.js';

export class OpenAIRealtimeService {
  constructor(ws, callSid, direction, clientId) {
    this.ws = ws;
    this.callSid = callSid;
    this.direction = direction;
    this.clientId = clientId;
    this.openaiWs = null;
    this.streamSid = null;
  }

  connect() {
    const url = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01';
    this.openaiWs = new WebSocket(url, {
      headers: {
        Authorization: `Bearer ${config.openai.apiKey}`,
        'OpenAI-Beta': 'realtime=v1',
      },
    });

    this.openaiWs.on('open', () => {
      logger.info('Connected to OpenAI Realtime API');
      this.initializeSession();
    });

    this.openaiWs.on('message', (data) => {
      try {
        const response = JSON.parse(data);
        this.handleOpenAIMessage(response);
      } catch (error) {
        logger.error('Error parsing OpenAI message:', error);
      }
    });

    this.openaiWs.on('close', () => {
      logger.info('OpenAI connection closed');
    });

    this.openaiWs.on('error', (error) => {
      logger.error('OpenAI WebSocket error:', error);
    });
  }

  initializeSession() {
    const sessionUpdate = {
      type: 'session.update',
      session: {
        turn_detection: { type: 'server_vad', silence_duration_ms: 1500 },
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        voice: 'coral',
        instructions: getSystemPrompt(this.direction),
        modalities: ['text', 'audio'],
        temperature: 0.8,
        tools: [
          {
            type: 'function',
            name: 'schedule_appointment',
            description: 'Schedule a technical assessment or meeting when the user agrees.',
            parameters: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Name of the contact person' },
                company: { type: 'string', description: 'Name of the company' },
                confirmedPhone: { type: 'string', description: 'The phone number confirmed by the user' },
                appointmentTime: { type: 'string', description: 'The agreed time for the appointment' },
                notes: { type: 'string', description: 'Any additional notes or specific needs mentioned' }
              },
              required: ['name', 'company', 'confirmedPhone', 'appointmentTime']
            }
          },
          {
            type: 'function',
            name: 'report_interaction',
            description: 'Report the outcome of the call if no appointment was scheduled (e.g., not interested, call later, voicemail).',
            parameters: {
              type: 'object',
              properties: {
                outcome: { type: 'string', enum: ['NOT_INTERESTED', 'CALL_LATER', 'VOICEMAIL', 'GATEKEEPER_BLOCK', 'OTHER'] },
                notes: { type: 'string', description: 'Details about the interaction' }
              },
              required: ['outcome']
            }
          },
          {
            type: 'function',
            name: 'end_call',
            description: 'End the call gracefully after saying goodbye.',
            parameters: {
              type: 'object',
              properties: {}
            }
          }
        ],
        tool_choice: 'auto',
      },
    };

    this.openaiWs.send(JSON.stringify(sessionUpdate));
  }

  handleTwilioMedia(data) {
    if (data.event === 'media' && this.openaiWs.readyState === WebSocket.OPEN) {
      const audioAppend = {
        type: 'input_audio_buffer.append',
        audio: data.media.payload,
      };
      this.openaiWs.send(JSON.stringify(audioAppend));
    } else if (data.event === 'start') {
      this.streamSid = data.start.streamSid;
      logger.info(`Stream started: ${this.streamSid}`);
    }
  }

  handleOpenAIMessage(response) {
    if (response.type === 'response.audio.delta' && response.delta) {
      const audioDelta = {
        event: 'media',
        streamSid: this.streamSid,
        media: {
          payload: response.delta,
        },
      };
      this.ws.send(JSON.stringify(audioDelta));
    }

    if (response.type === 'response.function_call_arguments.done') {
        // Wait for output_item.added (which contains the full call info) or handle function calls here?
        // Actually, 'response.output_item.done' with item.type === 'function_call' is better.
        // But for realtime API, it's a bit different. Let's look for 'response.done' or 'response.output_item.done'.
    }

    if (response.type === 'response.done') {
        const output = response.response.output || [];
        output.forEach(item => {
            if (item.type === 'function_call') {
                this.handleFunctionCall(item);
            }
        });
    }
  }

  async handleFunctionCall(item) {
    const { name, arguments: argsString } = item;
    const args = JSON.parse(argsString);
    const callId = item.call_id;

    logger.info(`Function call detected: ${name} with args: ${argsString}`);

    let result = { success: true };

    if (name === 'schedule_appointment') {
      await this.handleScheduleAppointment(args);
    } else if (name === 'report_interaction') {
      await this.handleReportInteraction(args);
    } else if (name === 'end_call') {
      await this.handleEndCall();
    }

    // Send function output back to OpenAI (optional, but good practice to close loop)
    const functionOutput = {
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: JSON.stringify(result),
      },
    };
    this.openaiWs.send(JSON.stringify(functionOutput));

    // Trigger another response generation if needed
    if (name !== 'end_call') {
        this.openaiWs.send(JSON.stringify({ type: 'response.create' }));
    }
  }

  async handleScheduleAppointment(args) {
    const leadData = {
      ...args,
      clientId: this.clientId,
      phone: this.clientId ? (await leadService.getClientById(this.clientId))?.phone : 'Unknown', // Caller ID from client record
      source: this.direction
    };

    await leadService.saveLead(leadData);
    await mailer.sendSuccessEmail(leadData);
    logger.info('Appointment scheduled and email sent.');
  }

  async handleReportInteraction(args) {
    const interactionData = {
      ...args,
      clientId: this.clientId,
      phone: this.clientId ? (await leadService.getClientById(this.clientId))?.phone : 'Unknown',
      source: this.direction
    };

    await leadService.logInteraction(interactionData);
    await mailer.sendReportEmail(interactionData);
    logger.info('Interaction reported.');
  }

  async handleEndCall() {
    logger.info('Ending call in 10 seconds...');
    // Wait 10 seconds before closing connection to allow the bot to say goodbye
    setTimeout(() => {
        if (this.ws.readyState === WebSocket.OPEN) {
            this.ws.close();
        }
        if (this.openaiWs.readyState === WebSocket.OPEN) {
            this.openaiWs.close();
        }
        // We do not emit callEnded here to avoid race conditions with Twilio's statusCallback.
        // The callController's handleStatusCallback will emit the event when the call actually ends.
    }, 10000);
  }
}
