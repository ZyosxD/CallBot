import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { createAppointment, checkAvailability } from './appointmentService.js';
import { getFAQAnswer } from './faqService.js';
import { transferToHuman } from './transferService.js';
import twilio from 'twilio';

export class OpenAIRealtimeService {
  constructor(ws, callSid) {
    this.ws = ws;
    this.callSid = callSid;
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
    const sessionUpdate = {
      type: 'session.update',
      session: {
        turn_detection: { type: 'server_vad' },
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        voice: 'alloy',
        instructions: prompts.systemInstruction,
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: [
          {
            type: "function",
            name: "check_availability",
            description: "Check availability for an appointment",
            parameters: {
              type: "object",
              properties: {
                date: { type: "string", description: "YYYY-MM-DD" },
                time: { type: "string", description: "HH:mm" }
              },
              required: ["date", "time"]
            }
          },
          {
            type: "function",
            name: "create_appointment",
            description: "Create a new appointment",
            parameters: {
              type: "object",
              properties: {
                name: { type: "string", description: "Patient name" },
                date: { type: "string", description: "YYYY-MM-DD" },
                time: { type: "string", description: "HH:mm" }
              },
              required: ["name", "date", "time"]
            }
          },
          {
            type: "function",
            name: "get_faq_answer",
            description: "Get answer for frequently asked questions",
            parameters: {
              type: "object",
              properties: {
                query: { type: "string", description: "User question" }
              },
              required: ["query"]
            }
          },
          {
            type: "function",
            name: "transfer_call",
            description: "Transfer the call to a human agent",
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
      if (name === 'check_availability') {
        const available = await checkAvailability(parsedArgs.date, parsedArgs.time);
        result = { available };
      } else if (name === 'create_appointment') {
        result = await createAppointment(parsedArgs);
      } else if (name === 'get_faq_answer') {
        const answer = getFAQAnswer(parsedArgs.query);
        result = { answer: answer || "I don't have information about that." };
      } else if (name === 'transfer_call') {
        // Handle transfer
        await this.handleTransfer();
        result = { status: 'transferring' };
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
      // Optionally send error back
    }
  }

  async handleTransfer() {
    try {
        logger.info(`Initiating transfer for call ${this.callSid}`);
        // Get TwiML for transfer
        const twiml = transferToHuman(this.callSid);

        // Update the call using Twilio REST API
        const client = twilio(config.twilio.accountSid, config.twilio.authToken);
        await client.calls(this.callSid).update({
            twiml: twiml
        });

        // Close websocket as the call is being transferred
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.close();
        }
        if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
            this.openaiWs.close();
        }

    } catch (error) {
        logger.error('Error handling transfer:', error);
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
