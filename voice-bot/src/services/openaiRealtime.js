import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { scheduleAppointment } from './appointmentService.js';
import { reportInteraction } from './reportService.js';

export class OpenAIRealtimeService {
  constructor(ws, callSid) {
    this.ws = ws;
    this.callSid = callSid;
    this.openaiWs = null;
    this.streamSid = null;
    this.callerId = 'unknown';
    this.mode = 'inbound';

    this.isTwilioStarted = false;
    this.isOpenAiConnected = false;
    this.sessionInitialized = false;
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

  checkAndInitializeSession() {
    if (this.isTwilioStarted && this.isOpenAiConnected && !this.sessionInitialized) {
      this.sendSessionUpdate();
      this.sessionInitialized = true;
    }
  }

  sendSessionUpdate() {
    const instructions = this.mode === 'outbound' ? prompts.SARAH_OUTBOUND : prompts.SARAH_INBOUND;

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
            description: "Schedule a Technical Assessment when the client agrees and provides all requirements (Contact Name, Company Name, Verified Phone, Exact Time).",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the person handling technology (IT Manager/Owner)" },
                companyName: { type: "string", description: "Company name to check the fiber map" },
                verifiedPhone: { type: "string", description: "The verbally confirmed phone number (is this the best number to reach you?)" },
                exactTime: { type: "string", description: "The exact time for the appointment" },
                notes: { type: "string", description: "Any additional details or pain points discussed" }
              },
              required: ["contactName", "companyName", "verifiedPhone", "exactTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report the interaction if the client is not interested, asks to call back later, or it's a voicemail.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Reason for the report (e.g., Not interested, Call back later, Voicemail)" },
                notes: { type: "string", description: "Any additional details or notes" }
              },
              required: ["reason"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the current call gracefully after a polite goodbye.",
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

    logger.info(`Function call detected: ${name} with args: ${args}`);
    let result = null;
    let parsedArgs;

    try {
      parsedArgs = JSON.parse(args);
    } catch (parseError) {
      logger.error('Error parsing function arguments:', parseError);
      return;
    }

    try {
      if (name === 'schedule_appointment') {
        parsedArgs.originalCallerId = this.callerId;
        result = await scheduleAppointment(parsedArgs);
      } else if (name === 'report_interaction') {
        parsedArgs.originalCallerId = this.callerId;
        result = await reportInteraction(parsedArgs);
      } else if (name === 'end_call') {
        // Handle end_call logic with 10s delay
        result = { status: 'ending_call' };

        // Send function output immediately to avoid model hanging
        this.sendToOpenAI({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: callId,
            output: JSON.stringify(result)
          }
        });

        // Trigger final goodbye response
        this.sendToOpenAI({ type: 'response.create' });

        // Delay closing sockets for 10 seconds
        setTimeout(async () => {
          logger.info(`Closing call ${this.callSid} after 10s delay`);
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
              this.ws.close();
          }
          if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
              this.openaiWs.close();
          }

          try {
            const { markCallEnded } = await import('./dripService.js');
            markCallEnded(this.callSid);
          } catch (err) {
            logger.error('Error releasing lock on end_call delay:', err);
          }
        }, 10000);

        return; // Return early, function output sent above
      }

      // Send result back to OpenAI for other functions
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
      this.sendToOpenAI({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify({ error: error.message })
        }
      });
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