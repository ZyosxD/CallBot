import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { scheduleAppointment, reportInteraction } from './appointmentService.js';
import twilio from 'twilio';

export class OpenAIRealtimeService {
  constructor(ws, callSid, context = 'inbound') {
    this.ws = ws;
    this.callSid = callSid;
    this.context = context;
    this.openaiWs = null;
    this.streamSid = null;
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
      });

    } catch (error) {
      logger.error('Error connecting to OpenAI:', error);
    }
  }

  sendSessionUpdate() {
    // Select instructions based on context
    const instructions = this.context === 'outbound' ? prompts.outbound : prompts.inbound;
    logger.info(`Using ${this.context} instructions for call ${this.callSid}`);

    const sessionUpdate = {
      type: 'session.update',
      session: {
        turn_detection: {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 300,
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
            description: "Schedule a Technical Assessment after gathering the Trifecta (Contact Name, Company Name, Phone, Time).",
            parameters: {
              type: "object",
              properties: {
                name: { type: "string", description: "Contact Name" },
                company: { type: "string", description: "Company Name" },
                phone: { type: "string", description: "Caller ID / Phone Number" },
                confirmedPhone: { type: "string", description: "Verbally confirmed phone number" },
                appointmentTime: { type: "string", description: "Date and Time for the appointment" },
                notes: { type: "string", description: "Any other relevant info" }
              },
              required: ["name", "company", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report an interaction if the client is not interested, or asks to call back later, or voicemail.",
            parameters: {
              type: "object",
              properties: {
                name: { type: "string", description: "Contact Name (if available)" },
                phone: { type: "string", description: "Phone Number" },
                reason: { type: "string", description: "Reason for reporting (e.g. Not Interested, Voicemail, Call Later)" },
                transcript: { type: "string", description: "Summary of conversation" }
              },
              required: ["phone", "reason"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call politely.",
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
    let result = null;

    try {
      if (name === 'schedule_appointment') {
        result = await scheduleAppointment(parsedArgs);
      } else if (name === 'report_interaction') {
        result = await reportInteraction(parsedArgs);
      } else if (name === 'end_call') {
        logger.info('Call ending initiated by model.');
        result = { status: 'ending' };

        // Wait 10 seconds before closing connection as per spec
        setTimeout(() => {
            if (this.ws) this.ws.close();
            if (this.openaiWs) this.openaiWs.close();
        }, 10000);
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

      // Trigger a response generation if not ending
      if (name !== 'end_call') {
          this.sendToOpenAI({ type: 'response.create' });
      }

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
    } else if (data.event === 'media') {
        const audioAppend = {
            type: 'input_audio_buffer.append',
            audio: data.media.payload
        };
        this.sendToOpenAI(audioAppend);
    }
  }
}
