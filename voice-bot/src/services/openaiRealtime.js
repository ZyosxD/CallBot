import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { addLead, addInteraction } from './dataService.js';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';

export class OpenAIRealtimeService {
  constructor(ws, callSid, callerId, mode) {
    this.ws = ws;
    this.callSid = callSid;
    this.callerId = callerId;
    this.mode = mode;
    this.openaiWs = null;
    this.streamSid = null;

    this.isTwilioStarted = false;
    this.isOpenAiConnected = false;
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
    if (this.isTwilioStarted && this.isOpenAiConnected) {
      logger.info('Both Twilio and OpenAI are connected. Initializing session.');
      this.sendSessionUpdate();

      // Start the conversation immediately with a specific greeting text
      this.sendToOpenAI({
        type: "response.create",
        response: {
          modalities: ["audio", "text"],
          instructions: "Say a short greeting to start the conversation immediately."
        }
      });
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
            description: "Schedule a Technical Assessment when the user agrees to proceed and all required information (Trifecta + exact time) has been collected.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the person we are speaking with" },
                companyName: { type: "string", description: "Name of the company" },
                confirmedPhone: { type: "string", description: "The confirmed phone number to reach them back on" },
                appointmentTime: { type: "string", description: "The exact date and time for the technical assessment tomorrow" },
                needs: { type: "string", description: "Notes on their detected needs (Internet, VoIP, or IT)" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Use this when the client is not interested, asks to call back later, or if you reach a voicemail.",
            parameters: {
              type: "object",
              properties: {
                status: { type: "string", enum: ["NOT_INTERESTED", "CALL_BACK_LATER", "VOICEMAIL", "OTHER"], description: "The outcome of the interaction" },
                notes: { type: "string", description: "Any relevant notes from the conversation" }
              },
              required: ["status"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call conversation. Use this ONLY after saving data or when the conversation is completely over.",
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
    const { name, arguments: args, call_id } = event;
    logger.info(`Function call detected: ${name} with args: ${args}`);

    let parsedArgs = {};
    try {
      parsedArgs = JSON.parse(args);
    } catch (e) {
      logger.error('Error parsing function arguments JSON:', e);
      return;
    }

    let result = null;

    try {
      if (name === 'schedule_appointment') {
        const leadData = {
          ...parsedArgs,
          callerId: this.callerId,
          callSid: this.callSid
        };
        await addLead(leadData);
        await sendSuccessEmail(leadData);
        result = { status: 'success', message: 'Appointment scheduled. You may now end the call gracefully.' };

      } else if (name === 'report_interaction') {
        const interactionData = {
          ...parsedArgs,
          callerId: this.callerId,
          callSid: this.callSid
        };
        await addInteraction(interactionData);
        await sendReportEmail(interactionData);
        result = { status: 'success', message: 'Interaction reported. You may now end the call gracefully.' };

      } else if (name === 'end_call') {
        result = { status: 'success', message: 'Call ending in 10 seconds.' };

        // Send a polite goodbye before ending
        this.sendToOpenAI({
          type: "response.create",
          response: {
            modalities: ["audio", "text"],
            instructions: "Say a short, polite goodbye."
          }
        });

        // 10 second delay before closing socket
        setTimeout(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
              this.ws.close();
          }
          if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
              this.openaiWs.close();
          }
        }, 10000);
      }

      // Must send function_call_output to prevent model from hanging
      const functionOutput = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: call_id,
          output: JSON.stringify(result || { status: 'unknown' })
        }
      };
      this.sendToOpenAI(functionOutput);

      // Trigger a response generation after processing tool output (except for end_call which did it manually)
      if (name !== 'end_call') {
        this.sendToOpenAI({ type: 'response.create' });
      }

    } catch (error) {
      logger.error(`Error executing function ${name}:`, error);
      const errorOutput = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: call_id,
          output: JSON.stringify({ error: error.message })
        }
      };
      this.sendToOpenAI(errorOutput);
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
