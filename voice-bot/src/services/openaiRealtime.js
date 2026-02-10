import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { addLead, addInteraction } from './leadService.js';
// We will create emailService.js in the next step
import { sendSuccessEmail, sendReportEmail } from './emailService.js';
import { callEnded } from './dripService.js';

export class OpenAIRealtimeService {
  constructor(ws, callSid) {
    this.ws = ws;
    this.callSid = callSid;
    this.openaiWs = null;
    this.streamSid = null;
    this.direction = 'inbound';
    this.clientId = null;
    this.phone = null;
  }

  setContext(direction, clientId, phone) {
    this.direction = direction;
    this.clientId = clientId;
    this.phone = phone;
    logger.info(`Context set: Direction=${direction}, ClientId=${clientId}, Phone=${phone}`);
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
    const systemInstruction = this.direction === 'outbound'
      ? prompts.COLD_CALLER_PROMPT
      : prompts.INBOUND_RECEPTIONIST_PROMPT;

    const sessionUpdate = {
      type: 'session.update',
      session: {
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 1500 // 1500ms as requested
        },
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        voice: 'coral', // "Coral" voice as requested
        instructions: systemInstruction,
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Schedule a technical assessment when the customer agrees (The Yes). Requires name, company, verified phone, and time.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the contact person" },
                companyName: { type: "string", description: "Name of the company" },
                phone: { type: "string", description: "Verified phone number for the call" },
                dateTime: { type: "string", description: "Date and time for the appointment" },
                notes: { type: "string", description: "Any additional notes or needs detected" }
              },
              required: ["contactName", "companyName", "phone", "dateTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report the interaction outcome if no appointment was scheduled (e.g., not interested, call later, voicemail).",
            parameters: {
              type: "object",
              properties: {
                outcome: { type: "string", enum: ["not_interested", "call_later", "voicemail", "other"], description: "Outcome of the call" },
                notes: { type: "string", description: "Details about the interaction" }
              },
              required: ["outcome"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call respectfully after saying goodbye.",
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
        addLead({
            clientId: this.clientId,
            ...parsedArgs
        });
        // Send email
        await sendSuccessEmail(parsedArgs, this.clientId);
        result = { message: "Appointment scheduled and email sent." };
      } else if (name === 'report_interaction') {
        // Save interaction
        addInteraction({
            clientId: this.clientId,
            phone: this.phone,
            ...parsedArgs
        });
        // Send email
        await sendReportEmail(parsedArgs, this.clientId, this.phone);
        result = { message: "Interaction reported." };
      } else if (name === 'end_call') {
        // Handle end call
        setTimeout(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.close();
            }
            callEnded(); // Notify drip service
        }, 10000); // 10 seconds delay as requested
        result = { message: "Ending call in 10 seconds." };
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
      // Send error back to OpenAI
       const functionOutput = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify({ error: error.message })
        }
      };
      this.sendToOpenAI(functionOutput);
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
