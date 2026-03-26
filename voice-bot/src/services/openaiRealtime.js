import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';
import twilio from 'twilio';

const LEADS_FILE = path.join(process.cwd(), 'src/data/leads.json');
const INTERACTIONS_FILE = path.join(process.cwd(), 'src/data/interactions.json');

export class OpenAIRealtimeService {
  constructor(ws, callSid, callerId, mode) {
    this.ws = ws;
    this.callSid = callSid;
    this.callerId = callerId;
    this.mode = mode;
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
        logger.info('Connected to OpenAI Realtime API');
        // Initial session setup must be deferred until we have stream parameters (callerId, mode)
        // Note: The memory states sendSessionUpdate must be called during 'open'.
        // We will call it here. The prompt will be chosen based on current this.mode.
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
    const prompt = this.mode === 'outbound' ? prompts.SARAH_OUTBOUND : prompts.SARAH_INBOUND;

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
        instructions: prompt,
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Schedule a technical assessment after the user says YES to scheduling.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Who should we ask for?" },
                companyName: { type: "string", description: "Name of the company" },
                confirmedPhone: { type: "string", description: "Best phone number to call" },
                appointmentTime: { type: "string", description: "Exact time for the assessment tomorrow" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report the outcome if the user is not interested, wants a callback, or if it's voicemail.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Reason for reporting (e.g., 'not interested', 'callback', 'voicemail')" },
                notes: { type: "string", description: "Any additional notes" }
              },
              required: ["reason"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call after the conversation is finished.",
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

    // Initial greeting
    const initialMessage = {
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'system',
        content: [{ type: 'input_text', text: 'Start the conversation immediately. Say: "Hi, this is Sarah. Are you the person handling the technology, or should I ask for an Office Manager?"' }]
      }
    };
    this.sendToOpenAI(initialMessage);
    this.sendToOpenAI({ type: 'response.create' });
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
        // Save to leads.json
        if (fs.existsSync(LEADS_FILE)) {
          const leads = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf-8'));
          leads.push({ ...parsedArgs, callerId: this.callerId, callSid: this.callSid, timestamp: new Date().toISOString() });
          fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
        }

        // Send Email
        await sendSuccessEmail(parsedArgs, this.callerId);
        result = { status: 'success' };

      } else if (name === 'report_interaction') {
        // Save to interactions.json
        if (fs.existsSync(INTERACTIONS_FILE)) {
          const interactions = JSON.parse(fs.readFileSync(INTERACTIONS_FILE, 'utf-8'));
          interactions.push({ ...parsedArgs, callerId: this.callerId, callSid: this.callSid, timestamp: new Date().toISOString() });
          fs.writeFileSync(INTERACTIONS_FILE, JSON.stringify(interactions, null, 2));
        }

        // Send Email
        await sendReportEmail(parsedArgs, this.callerId);
        result = { status: 'reported' };

      } else if (name === 'end_call') {
        result = { status: 'ending_call' };
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
        // Final goodbye message
        const finalMessage = {
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'system',
            content: [{ type: 'input_text', text: 'Say a short, polite goodbye right before the call ends.' }]
          }
        };
        this.sendToOpenAI(finalMessage);
        this.sendToOpenAI({ type: 'response.create' });

        // Delay 10 seconds
        setTimeout(() => {
          logger.info(`Ending call ${this.callSid} after 10 seconds.`);
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

  handleTwilioMedia(data) {
    if (data.event === 'start') {
      this.streamSid = data.start.streamSid;
      this.callSid = data.start.callSid; // Update CallSid from start event
      logger.info(`Stream started: ${this.streamSid}`);

      // We send session update in 'open', but if Twilio starts after, we might want to ensure it has correct mode/callerId
      // In Fastify WebSocket we process the query strings or customParams first.

    } else if (data.event === 'media') {
        const audioAppend = {
            type: 'input_audio_buffer.append',
            audio: data.media.payload
        };
        this.sendToOpenAI(audioAppend);
    }
  }
}
