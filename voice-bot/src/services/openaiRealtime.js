import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { schedule_appointment, report_interaction } from './appointmentService.js';

export class OpenAIRealtimeService {
  constructor(ws, callSid) {
    this.ws = ws;
    this.callSid = callSid;
    this.openaiWs = null;
    this.streamSid = null;

    this.isOpenAiConnected = false;
    this.isTwilioStarted = false;

    this.callerId = 'Unknown';
    this.mode = 'inbound';
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
            description: "Schedule a technical assessment after getting contactName, companyName, confirmedPhone, and appointmentTime (The Trifecta + Time).",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the person" },
                companyName: { type: "string", description: "Name of the company" },
                confirmedPhone: { type: "string", description: "Verbally confirmed best phone number to call" },
                appointmentTime: { type: "string", description: "Exact time for the appointment" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Log an interaction if the client is not interested, asks to call back later, or if it is a voicemail.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Reason why it didn't result in an appointment (e.g., 'not interested', 'voicemail')" },
                notes: { type: "string", description: "Any additional notes or details." }
              },
              required: ["reason"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call gracefully. Use this only after scheduling an appointment, reporting an interaction, or when the user hangs up.",
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

        // For outbound calls, initiate greeting after session creation
        if (this.mode === 'outbound') {
            this.sendToOpenAI({ type: 'response.create' });
        }
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
    let parsedArgs = {};

    try {
        parsedArgs = JSON.parse(args);
    } catch (e) {
        logger.error(`Error parsing args for tool ${name}:`, e);
        result = { status: 'error', message: 'SyntaxError in arguments.' };
        return this.resolveFunctionCall(callId, result);
    }

    try {
      if (name === 'schedule_appointment') {
        result = await schedule_appointment(parsedArgs, this.callerId);
        this.resolveFunctionCall(callId, result);
        this.sendToOpenAI({ type: 'response.create' }); // trigger confirmation
      } else if (name === 'report_interaction') {
        result = await report_interaction(parsedArgs, this.callerId);
        this.resolveFunctionCall(callId, result);
        this.sendToOpenAI({ type: 'response.create' }); // trigger confirmation
      } else if (name === 'end_call') {
        result = { status: 'ending_call' };
        this.resolveFunctionCall(callId, result);

        // Prompt a final goodbye
        this.sendToOpenAI({
            type: 'conversation.item.create',
            item: {
                type: 'message',
                role: 'system',
                content: [{ type: 'input_text', text: 'Say a short polite goodbye and nothing else.' }]
            }
        });
        this.sendToOpenAI({ type: 'response.create' });

        // 10s delay
        setTimeout(() => {
            logger.info(`10s timeout reached for call ${this.callSid}. Closing socket.`);
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.close();
            }
        }, 10000);
      } else {
          result = { status: 'error', message: 'Unknown tool.' };
          this.resolveFunctionCall(callId, result);
      }

    } catch (error) {
      logger.error(`Error executing function ${name}:`, error);
      this.resolveFunctionCall(callId, { status: 'error', message: 'Execution failed.' });
    }
  }

  resolveFunctionCall(callId, result) {
      const functionOutput = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify(result)
        }
      };
      this.sendToOpenAI(functionOutput);
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
