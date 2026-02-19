import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { scheduleAppointment, reportInteraction } from './appointmentService.js';

export class OpenAIRealtimeService {
  constructor(ws, callSid, context = 'inbound', callerId = 'unknown') {
    this.ws = ws;
    this.callSid = callSid;
    this.context = context;
    this.callerId = callerId;
    this.openaiWs = null;
    this.streamSid = null;
    this.ending = false;
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
        logger.info(`Connected to OpenAI Realtime API for ${this.context} call`);
        this.sendSessionUpdate();
      });

      this.openaiWs.on('message', (data) => {
        if (!this.ending) {
          this.handleOpenAIMessage(data);
        }
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
    const prompt = this.context === 'outbound' ? prompts.outbound : prompts.inbound;
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
        instructions: prompt,
        modalities: ["text", "audio"],
        temperature: 0.7,
        tools: prompts.tools,
        tool_choice: "auto"
      },
    };
    this.sendToOpenAI(sessionUpdate);
  }

  async handleOpenAIMessage(data) {
    try {
      const event = JSON.parse(data);

      if (event.type === 'response.audio.delta' && event.delta) {
        this.sendAudioToTwilio(event.delta);
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
        result = await scheduleAppointment(parsedArgs, this.callSid, this.callerId);
      } else if (name === 'report_interaction') {
        result = await reportInteraction(parsedArgs, this.callSid, this.callerId);
      } else if (name === 'end_call') {
        this.ending = true;
        logger.info(`Ending call in 10 seconds...`);
        setTimeout(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.close();
            logger.info(`Call ended.`);
          }
        }, 10000); // 10s delay
        result = { success: true, message: "Ending call in 10 seconds." };
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

      // If we are ending the call, we might not want to trigger another response,
      // but usually the model says "Goodbye" and calls end_call.
      // We want to ensure it finishes speaking.
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
      // Also potentially update callSid if it wasn't available at init
      if (data.start.callSid && this.callSid === 'unknown') {
          this.callSid = data.start.callSid;
      }
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
