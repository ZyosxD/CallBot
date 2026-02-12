import WebSocket from 'ws';
import { config } from '../config/config.js';
import { getSystemInstruction } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { saveLead, saveInteraction } from './leadService.js';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';

export class OpenAIRealtimeService {
  constructor(ws, callSid, context = {}) {
    this.ws = ws;
    this.callSid = callSid;
    this.context = context; // { type, clientId, clientName, callerPhone }
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
    const instructions = getSystemInstruction(this.context.type);

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
        temperature: 0.6,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Schedule a technical assessment after getting the Trifecta (Name, Company, Verified Phone) + Time.",
            parameters: {
              type: "object",
              properties: {
                name: { type: "string", description: "Contact Name" },
                companyName: { type: "string", description: "Company Name" },
                phone: { type: "string", description: "Verified Phone Number" },
                appointmentTime: { type: "string", description: "Date and Time for the call" },
                notes: { type: "string", description: "Any specific needs or pain points mentioned" }
              },
              required: ["name", "companyName", "phone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report the interaction outcome (Not interested, Call later, Voicemail).",
            parameters: {
              type: "object",
              properties: {
                outcome: { type: "string", enum: ["not_interested", "call_later", "voicemail", "other"] },
                notes: { type: "string", description: "Details about the interaction" }
              },
              required: ["outcome"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call. Use this after scheduling or when conversation is over.",
            parameters: {
              type: "object",
              properties: {}
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
    let result = { success: true };

    try {
      if (name === 'schedule_appointment') {
        const leadData = {
            ...parsedArgs,
            clientId: this.context.clientId || 'inbound',
            callerId: this.context.callerPhone
        };
        await saveLead(leadData);
        await sendSuccessEmail(leadData);
        result = { message: "Appointment scheduled and email sent." };
      }
      else if (name === 'report_interaction') {
        const interactionData = {
            ...parsedArgs,
            clientId: this.context.clientId || 'inbound',
            clientName: this.context.clientName || 'Unknown',
            phone: this.context.callerPhone
        };
        await saveInteraction(interactionData);
        await sendReportEmail(interactionData);
        result = { message: "Interaction reported." };
      }
      else if (name === 'end_call') {
        logger.info('Tool requested end_call. Closing in 10s...');

        setTimeout(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.close();
            }
             if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
                this.openaiWs.close();
            }
        }, 10000);

        result = { message: "Call will end in 10 seconds." };
      }

      const functionOutput = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify(result)
        }
      };
      this.sendToOpenAI(functionOutput);

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
    } else if (data.event === 'media') {
        const audioAppend = {
            type: 'input_audio_buffer.append',
            audio: data.media.payload
        };
        this.sendToOpenAI(audioAppend);
    }
  }
}
