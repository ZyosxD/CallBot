import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { appendLead, appendInteraction } from './dataService.js';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';
import twilio from 'twilio';

export class OpenAIRealtimeService {
  constructor(ws, callSid, callerId = 'unknown', mode = 'inbound') {
    this.ws = ws;
    this.callSid = callSid;
    this.callerId = callerId;
    this.mode = mode;
    this.openaiWs = null;
    this.streamSid = null;

    this.isOpenAiConnected = false;
    this.isTwilioStarted = false;
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
        this.isOpenAiConnected = true;
        this.checkAndInitializeSession();
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

  handleTwilioMedia(data) {
    if (data.event === 'start') {
      this.streamSid = data.start.streamSid;
      logger.info(`Stream started: ${this.streamSid}`);
      this.isTwilioStarted = true;
      this.checkAndInitializeSession();
    } else if (data.event === 'media') {
        const audioAppend = {
            type: 'input_audio_buffer.append',
            audio: data.media.payload
        };
        this.sendToOpenAI(audioAppend);
    }
  }

  checkAndInitializeSession() {
      if (this.isOpenAiConnected && this.isTwilioStarted) {
          this.sendSessionUpdate();
      }
  }

  sendSessionUpdate() {
    const instructions = this.mode === 'inbound' ? prompts.SARAH_INBOUND : prompts.SARAH_OUTBOUND;

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
            description: "Schedule a technical assessment after securing The Trifecta",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Who are we asking for?" },
                companyName: { type: "string", description: "Company Name" },
                confirmedPhone: { type: "string", description: "The confirmed verbal phone number" },
                appointmentTime: { type: "string", description: "Exact time for tomorrow" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report the interaction when client is not interested, asks to call back later, or it's a voicemail",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Reason for report (e.g., Not interested, Voicemail, Call back later)" },
                details: { type: "string", description: "Any additional context" }
              },
              required: ["reason"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call gracefully at the end of the conversation",
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
    const callId = event.call_id;
    let parsedArgs = {};

    try {
        parsedArgs = JSON.parse(args);
    } catch (err) {
        logger.error(`Failed to parse function args for ${name}: ${args}`, err);
        return;
    }

    logger.info(`Function call detected: ${name} with args: ${args}`);
    let result = null;

    try {
      if (name === 'schedule_appointment') {
        await appendLead({ ...parsedArgs, callerId: this.callerId });
        await sendSuccessEmail(parsedArgs, this.callerId);
        result = { status: 'appointment scheduled successfully' };
      } else if (name === 'report_interaction') {
        await appendInteraction({ ...parsedArgs, callerId: this.callerId });
        await sendReportEmail(parsedArgs, this.callerId);
        result = { status: 'interaction reported' };
      } else if (name === 'end_call') {
        result = { status: 'ending call in 10 seconds' };
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

      if (name === 'end_call') {
          // Send polite goodbye first
          this.sendToOpenAI({
              type: 'response.create',
              response: {
                  instructions: 'Say a very short, polite goodbye.'
              }
          });

          // Wait 10 seconds before closing
          setTimeout(() => {
              logger.info(`Closing sockets for call ${this.callSid} after end_call`);
              if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                  this.ws.close();
              }
              if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
                  this.openaiWs.close();
              }
          }, 10000);
      } else {
          // Trigger a response generation
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
}
