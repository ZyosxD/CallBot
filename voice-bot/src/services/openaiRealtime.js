import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { scheduleAppointment } from './appointmentService.js';
import { reportInteraction } from './interactionService.js';
import twilio from 'twilio';

export class OpenAIRealtimeService {
  constructor(ws, callSid, callerId) {
    this.ws = ws;
    this.callSid = callSid;
    this.callerId = callerId;
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
        this.isOpenAiConnected = false;
      });

    } catch (error) {
      logger.error('Error connecting to OpenAI:', error);
    }
  }

  checkAndInitializeSession() {
    if (this.isOpenAiConnected && this.isTwilioStarted) {
      this.sendSessionUpdate();
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
        temperature: 0.8,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Schedule a Technical Assessment after gathering The Trifecta (Contact Name, Company Name, Verified Phone, Exact Time).",
            parameters: {
              type: "object",
              properties: {
                name: { type: "string", description: "Contact Name" },
                company: { type: "string", description: "Company Name" },
                verifiedPhone: { type: "string", description: "Verified Phone Number" },
                time: { type: "string", description: "Exact Appointment Time" },
                notes: { type: "string", description: "Optional notes about their needs (e.g., internet issues, VoIP needs)" }
              },
              required: ["name", "company", "verifiedPhone", "time"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Log an interaction if the client is not interested, asks to call back later, or reaches a voicemail.",
            parameters: {
              type: "object",
              properties: {
                status: { type: "string", description: "Status of the call (e.g., Not Interested, Callback Later, Voicemail)" },
                summary: { type: "string", description: "Brief summary of what happened." }
              },
              required: ["status", "summary"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call when the conversation naturally concludes.",
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
    let result = null;
    let parsedArgs = {};

    logger.info(`Function call detected: ${name} with args: ${args}`);

    try {
      parsedArgs = JSON.parse(args);
    } catch (e) {
      logger.error(`SyntaxError parsing arguments for ${name}:`, e);
      result = { error: "Failed to parse arguments." };
    }

    if (!result) {
      try {
        if (name === 'schedule_appointment') {
          result = await scheduleAppointment(parsedArgs, this.callerId);
        } else if (name === 'report_interaction') {
          result = await reportInteraction(parsedArgs, this.callerId);
        } else if (name === 'end_call') {
          result = { status: "ending_call" };

          // Send function output first so model doesn't hang
          this.sendToOpenAI({
            type: 'conversation.item.create',
            item: {
              type: 'function_call_output',
              call_id: callId,
              output: JSON.stringify(result)
            }
          });

          // Instruct model to say goodbye
          this.sendToOpenAI({ type: 'response.create' });

          // Wait 10s to let audio stream, then close connection
          setTimeout(() => {
            logger.info(`Closing WebSocket for call ${this.callSid} after 10s delay`);
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
              this.ws.close();
            }
          }, 10000);

          return; // Skip standard response block below since we handled it uniquely
        }
      } catch (error) {
        logger.error(`Error executing function ${name}:`, error);
        result = { error: error.message };
      }
    }

    // Send result back to OpenAI for regular functions
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
}
