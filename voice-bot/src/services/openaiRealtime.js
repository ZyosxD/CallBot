import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { addLead, logInteraction as logLeadInteraction } from './leadService.js';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';
import twilio from 'twilio';

export class OpenAIRealtimeService {
  constructor(ws, callSid, direction = 'inbound') {
    this.ws = ws;
    this.callSid = callSid;
    this.direction = direction;
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
        logger.info(`Connected to OpenAI Realtime API for ${this.direction} call ${this.callSid}`);
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
        turn_detection: { type: 'server_vad', silence_duration_ms: 1500 },
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        voice: 'coral',
        instructions: prompts.systemInstruction(this.direction),
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Schedule an appointment when 'Trifecta' + Time is collected.",
            parameters: {
              type: "object",
              properties: {
                name: { type: "string", description: "Contact Name" },
                company: { type: "string", description: "Company Name" },
                phone: { type: "string", description: "Caller ID or Phone" },
                confirmedPhone: { type: "string", description: "Verified Phone Number" },
                appointmentTime: { type: "string", description: "Date and Time for appointment" },
                needs: { type: "string", description: "Identified needs (Internet, VoIP, IT)" }
              },
              required: ["name", "company", "confirmedPhone", "appointmentTime", "needs"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report interaction if client is not interested, asks to call later, or voicemail.",
            parameters: {
              type: "object",
              properties: {
                phone: { type: "string", description: "Phone number" },
                reason: { type: "string", description: "Reason (Not Interested, Call Later, Voicemail)" },
                notes: { type: "string", description: "Additional notes" }
              },
              required: ["phone", "reason"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call when conversation is finished.",
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
        // Save lead and send green email
        const leadData = { ...parsedArgs, callSid: this.callSid };
        addLead(leadData);
        await sendSuccessEmail(leadData);
        result = { status: 'scheduled' };
      } else if (name === 'report_interaction') {
        // Log interaction and send orange email
        const reportData = { ...parsedArgs, callSid: this.callSid };
        logLeadInteraction(reportData);
        await sendReportEmail(reportData);
        result = { status: 'reported' };
      } else if (name === 'end_call') {
        // End call
        setTimeout(() => {
           this.endConnection();
        }, 10000); // 10s delay as per spec
        result = { status: 'ending' };
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

  endConnection() {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.close();
      }
      if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
          this.openaiWs.close();
      }
      logger.info(`Call ${this.callSid} ended by bot.`);
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
