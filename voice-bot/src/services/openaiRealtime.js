import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { saveLead, logInteraction } from './leadService.js';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';
import eventBus from '../utils/events.js';

export class OpenAIRealtimeService {
  constructor(ws, callSid, callDetails = {}) {
    this.ws = ws; // Twilio WebSocket
    this.callSid = callSid;
    this.callDetails = callDetails; // { clientId, phone, direction }
    this.openaiWs = null;
    this.streamSid = null;
    this.isCallEnding = false;
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
        this.cleanup();
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
            silence_duration_ms: 1500
        },
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        voice: 'coral',
        instructions: prompts.systemInstruction,
        modalities: ["text", "audio"],
        temperature: 0.6,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Schedule a technical assessment when the user agrees.",
            parameters: {
              type: "object",
              properties: {
                name: { type: "string", description: "Contact Name" },
                company: { type: "string", description: "Company Name" },
                phone: { type: "string", description: "Verified Phone Number" },
                dateTime: { type: "string", description: "Preferred Date and Time" }
              },
              required: ["name", "company", "phone", "dateTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report the outcome if not interested, voicemail, or call back later.",
            parameters: {
              type: "object",
              properties: {
                result: {
                    type: "string",
                    enum: ["NOT_INTERESTED", "CALL_BACK_LATER", "VOICEMAIL", "WRONG_NUMBER"],
                    description: "The outcome of the call"
                },
                notes: { type: "string", description: "Any additional notes" }
              },
              required: ["result"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call politely after scheduling or reporting.",
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

    logger.info(`Function call detected: ${name}`);
    let result = { status: 'success' };

    try {
      if (name === 'schedule_appointment') {
        const leadData = {
            ...parsedArgs,
            originalPhone: this.callDetails.phone
        };
        await saveLead(leadData);
        await sendSuccessEmail(leadData);
        result = { message: "Appointment scheduled successfully." };

      } else if (name === 'report_interaction') {
        const reportData = {
            ...parsedArgs,
            phone: this.callDetails.phone,
            clientId: this.callDetails.clientId
        };
        await logInteraction(reportData);
        await sendReportEmail(reportData);
        result = { message: "Interaction reported." };

      } else if (name === 'end_call') {
        this.initiateEndCall();
        result = { message: "Ending call." };
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

  initiateEndCall() {
      if (this.isCallEnding) return;
      this.isCallEnding = true;

      logger.info('Initiating polite end call sequence (10s delay)...');

      // Wait 10 seconds before actually closing to allow for goodbye
      setTimeout(() => {
          logger.info('Closing connection now.');
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
              this.ws.close();
          }
          if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
            this.openaiWs.close();
        }
      }, 10000);
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
    } else if (data.event === 'stop') {
        logger.info('Twilio stream stopped.');
        this.cleanup();
    }
  }

  cleanup() {
      logger.info(`Cleaning up call ${this.callSid}`);
      eventBus.emit('callEnded', this.callSid);
      if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
          this.openaiWs.close();
      }
  }
}
