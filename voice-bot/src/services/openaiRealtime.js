import WebSocket from 'ws';
import { config } from '../config/config.js';
import { systemInstruction, tools } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { addLead, logInteraction } from './leadService.js';
import { sendEmail } from './emailService.js';

export class OpenAIRealtimeService {
  constructor(ws, callSid, clientData = {}) {
    this.ws = ws;
    this.callSid = callSid;
    this.clientData = clientData; // Expected to contain id, name, phone
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
        logger.info(`Connected to OpenAI Realtime API for Call SID: ${this.callSid}`);
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
        turn_detection: {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 1500
        },
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        voice: 'coral',
        instructions: systemInstruction,
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: tools,
        tool_choice: "auto",
      },
    };
    this.sendToOpenAI(sessionUpdate);
  }

  async handleOpenAIMessage(data) {
    try {
      const event = JSON.parse(data);

      if (event.type === 'session.created') {
        logger.info('OpenAI Session Created');
        this.sendToOpenAI({
            type: 'response.create',
            response: {
                instructions: "Say hello as Sarah from 1Wire."
            }
        });
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
      const { name, arguments: args, call_id } = event;
      const parsedArgs = JSON.parse(args);
      let result = { success: true };

      logger.info(`Tool called: ${name} with args: ${args}`);

      try {
        if (name === 'schedule_appointment') {
            await addLead({ ...parsedArgs, clientId: this.clientData.id });
            await sendEmail('SUCCESS', {
                ...parsedArgs,
                callerId: this.clientData.phone, // Twilio/Original Phone
                clientName: this.clientData.name
            });
            logger.info('Appointment scheduled and email sent.');
        } else if (name === 'report_interaction') {
            await logInteraction({ ...parsedArgs, clientId: this.clientData.id });
            await sendEmail('REPORT', {
                ...parsedArgs,
                clientName: this.clientData.name,
                callerId: this.clientData.phone
            });
            logger.info('Interaction reported and email sent.');
        } else if (name === 'end_call') {
            logger.info('Ending call as requested by AI. Closing in 10s.');
            // Send a final output to acknowledge
            const functionOutput = {
                type: 'conversation.item.create',
                item: {
                    type: 'function_call_output',
                    call_id: call_id,
                    output: JSON.stringify({ message: "Goodbye" })
                }
            };
            this.sendToOpenAI(functionOutput);
            this.sendToOpenAI({ type: 'response.create' });

            setTimeout(() => {
                if (this.ws) this.ws.close();
                if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) this.openaiWs.close();
            }, 10000);
            return; // Exit early so we don't send another response create
        }
      } catch (err) {
          logger.error(`Error executing tool ${name}:`, err);
          result = { success: false, error: err.message };
      }

      const functionOutput = {
        type: 'conversation.item.create',
        item: {
            type: 'function_call_output',
            call_id: call_id,
            output: JSON.stringify(result)
        }
      };
      this.sendToOpenAI(functionOutput);
      this.sendToOpenAI({ type: 'response.create' });
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
