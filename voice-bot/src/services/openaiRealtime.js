import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { createAppointment } from './appointmentService.js';
import { reportInteraction } from './interactionService.js';
import twilio from 'twilio';

export class OpenAIRealtimeService {
  constructor(ws, callSid, callerId, mode) {
    this.ws = ws;
    this.callSid = callSid;
    this.callerId = callerId;
    this.mode = mode; // 'inbound' or 'outbound'
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
        instructions: prompts.systemInstruction(this.mode),
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Schedule a Technical Assessment after gathering The Trifecta (Contact Name, Company Name, Verified Phone, Exact Time). Do NOT call this until you have all 4 pieces of info.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the person (e.g., IT Manager or Owner)" },
                companyName: { type: "string", description: "Name of the company" },
                verifiedPhone: { type: "string", description: "Verbal confirmed phone number" },
                exactTime: { type: "string", description: "Exact time for the appointment, e.g. Tomorrow at 10 AM" }
              },
              required: ["contactName", "companyName", "verifiedPhone", "exactTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Log the interaction when the client is not interested, asks to call back later, or reaches a voicemail.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "The reason for logging (e.g., 'Not interested', 'Call back later', 'Voicemail')" },
                verifiedPhone: { type: "string", description: "Any confirmed phone number if obtained, otherwise empty string" }
              },
              required: ["reason"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call gracefully at the conclusion of the conversation.",
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

        // If outbound, trigger initial greeting
        if (this.mode === 'outbound') {
             this.sendToOpenAI({
                 type: 'conversation.item.create',
                 item: {
                     type: 'message',
                     role: 'user',
                     content: [
                         {
                             type: 'input_text',
                             text: 'Hi, the call has connected. Please say hello and execute Gatekeeper Navigation.'
                         }
                     ]
                 }
             });
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
    let parsedArgs;

    try {
        parsedArgs = JSON.parse(args);
    } catch(e) {
        logger.error(`SyntaxError parsing JSON for tool ${name}: ${e.message}`);
        parsedArgs = {};
    }

    try {
      if (name === 'schedule_appointment') {
        const appointmentData = {
           ...parsedArgs,
           originalCallerId: this.callerId
        };
        result = await createAppointment(appointmentData);
      } else if (name === 'report_interaction') {
        const reportData = {
           ...parsedArgs,
           originalCallerId: this.callerId
        };
        result = await reportInteraction(reportData);
      } else if (name === 'end_call') {
        result = { status: 'ending call' };

        // Send function output first to resolve the tool call and prevent hanging
        const functionOutput = {
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: callId,
            output: JSON.stringify(result)
          }
        };
        this.sendToOpenAI(functionOutput);

        // Ask the bot to say a quick goodbye
        this.sendToOpenAI({
             type: 'conversation.item.create',
             item: {
                 type: 'message',
                 role: 'user',
                 content: [
                     {
                         type: 'input_text',
                         text: 'The call is ending. Please say a very short, polite goodbye.'
                     }
                 ]
             }
        });
        this.sendToOpenAI({ type: 'response.create' });

        logger.info(`Ending call for CallSid: ${this.callSid} in 10s...`);
        setTimeout(() => {
             if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                 this.ws.close();
             }
        }, 10000);
        return; // Early return since we already sent functionOutput
      }

      // Send result back to OpenAI for other tools
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
      // Send error back to prevent hang
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
