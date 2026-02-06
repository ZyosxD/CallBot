import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { schedule_appointment, report_interaction } from './leadService.js';
import { transferToHuman } from './transferService.js';
import twilio from 'twilio';

export class OpenAIRealtimeService {
  constructor(ws, callSid, callType = 'outbound') {
    this.ws = ws;
    this.callSid = callSid;
    this.callType = callType;
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
        logger.info(`Connected to OpenAI Realtime API (Type: ${this.callType})`);
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
    // Select instruction based on call type
    const instruction = this.callType === 'inbound'
      ? prompts.inboundSystemInstruction
      : prompts.outboundSystemInstruction;

    const sessionUpdate = {
      type: 'session.update',
      session: {
        turn_detection: { type: 'server_vad', silence_duration_ms: 1500 }, // Adjusted to 1500ms as per Master Spec
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        voice: 'coral', // "Coral" voice as per Master Spec
        instructions: instruction,
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Schedule a Technical Assessment. Use ONLY when you have Name, Company, Phone, and Time.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the contact person" },
                companyName: { type: "string", description: "Name of the company" },
                phone: { type: "string", description: "Verified phone number" },
                time: { type: "string", description: "Proposed time for the call (e.g. 'Tomorrow 2 PM')" }
              },
              required: ["contactName", "companyName", "phone", "time"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report the outcome if not interested, voicemail, or callback requested.",
            parameters: {
              type: "object",
              properties: {
                result: { type: "string", enum: ["NOT_INTERESTED", "VOICEMAIL", "CALLBACK_LATER", "OTHER"] },
                notes: { type: "string", description: "Brief summary or reason" }
              },
              required: ["result"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the conversation and hang up.",
            parameters: {
              type: "object",
              properties: {},
            }
          },
          {
            type: "function",
            name: "transfer_call",
            description: "Transfer to a human agent (Support or Office Manager).",
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
        result = await schedule_appointment(parsedArgs);
      } else if (name === 'report_interaction') {
        result = await report_interaction(parsedArgs);
      } else if (name === 'transfer_call') {
        await this.handleTransfer();
        result = { status: 'transferring' };
      } else if (name === 'end_call') {
        logger.info('AI requested to end call');
        setTimeout(() => {
           if (this.ws) this.ws.close();
        }, 10000); // 10s delay as per Master Spec
        result = { status: 'ending_call' };
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

  async handleTransfer() {
    try {
        logger.info(`Initiating transfer for call ${this.callSid}`);
        const twiml = transferToHuman(this.callSid);

        const client = twilio(config.twilio.accountSid, config.twilio.authToken);
        await client.calls(this.callSid).update({
            twiml: twiml
        });

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
