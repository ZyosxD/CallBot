import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';

const LEADS_FILE = path.join(process.cwd(), 'src', 'data', 'leads.json');
const INTERACTIONS_FILE = path.join(process.cwd(), 'src', 'data', 'interactions.json');

export class OpenAIRealtimeService {
  constructor(ws, callSid, callerId = 'unknown', mode = 'inbound') {
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
        // We do NOT sendSessionUpdate here. We wait for the Twilio stream 'start' event in handleTwilioMedia
        // or from handleWebSocket where parameters are captured.
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
            description: "Schedules a technical assessment. Requires The Trifecta: contactName, companyName, confirmedPhone, and appointmentTime.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the person" },
                companyName: { type: "string", description: "Name of the company" },
                confirmedPhone: { type: "string", description: "The verbally confirmed phone number to reach them" },
                appointmentTime: { type: "string", description: "The exact date/time for the assessment" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Logs the outcome of the call if the user is not interested, asks to call back later, or it went to voicemail.",
            parameters: {
              type: "object",
              properties: {
                outcome: { type: "string", description: "The result of the call (e.g., 'Not Interested', 'Voicemail', 'Call Later')" },
                notes: { type: "string", description: "Any additional context" }
              },
              required: ["outcome"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "Ends the call gracefully. Use this at the very end of the conversation.",
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

    // Initial greeting trigger
    const initialText = this.mode === 'outbound'
      ? "Hi, um, do you handle the tech or should I ask for an Office Manager?"
      : "Hi, thanks for calling 1Wire. Um, how can I help you today?";

    this.sendToOpenAI({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: `Start the conversation immediately. Say exactly: "${initialText}"` }]
      }
    });
    this.sendToOpenAI({ type: "response.create" });
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

    let parsedArgs = {};
    try {
      parsedArgs = JSON.parse(args);
    } catch (error) {
      logger.error(`SyntaxError parsing tool arguments for ${name}:`, error);
      // Return a polite error to the AI
      this.sendToOpenAI({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify({ status: 'error', message: 'Invalid JSON format in arguments.' })
        }
      });
      return;
    }

    let result = null;

    try {
      if (name === 'schedule_appointment') {
        const leadData = {
          contactName: parsedArgs.contactName,
          companyName: parsedArgs.companyName,
          confirmedPhone: parsedArgs.confirmedPhone,
          appointmentTime: parsedArgs.appointmentTime,
          timestamp: new Date().toISOString(),
          originalCallerId: this.callerId
        };

        let leads = [];
        try {
          if (fs.existsSync(LEADS_FILE)) leads = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8'));
        } catch (e) { logger.error('Error reading leads file:', e); }
        leads.push(leadData);
        fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));

        await sendSuccessEmail(leadData, this.callerId);
        result = { status: 'success', message: 'Appointment booked successfully and email sent.' };

      } else if (name === 'report_interaction') {
        const reportData = {
          outcome: parsedArgs.outcome,
          notes: parsedArgs.notes,
          timestamp: new Date().toISOString(),
          originalCallerId: this.callerId
        };

        let interactions = [];
        try {
          if (fs.existsSync(INTERACTIONS_FILE)) interactions = JSON.parse(fs.readFileSync(INTERACTIONS_FILE, 'utf8'));
        } catch (e) { logger.error('Error reading interactions file:', e); }
        interactions.push(reportData);
        fs.writeFileSync(INTERACTIONS_FILE, JSON.stringify(interactions, null, 2));

        await sendReportEmail(reportData, this.callerId);
        result = { status: 'success', message: 'Interaction logged and report emailed.' };

      } else if (name === 'end_call') {
        logger.info(`Ending call ${this.callSid} in 10 seconds.`);

        result = { status: 'ending_call' };

        // Instruct the AI to say goodbye politely right before hanging up
        this.sendToOpenAI({
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Say a short, polite goodbye to the user right now." }]
          }
        });
        this.sendToOpenAI({ type: "response.create" });

        // Close after 10s delay
        setTimeout(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
              this.ws.close();
          }
          if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
              this.openaiWs.close();
          }
        }, 10000);
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

      if (name !== 'end_call') {
        // Trigger a response generation for normal tools
        this.sendToOpenAI({ type: 'response.create' });
      }

    } catch (error) {
      logger.error(`Error executing function ${name}:`, error);
      this.sendToOpenAI({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify({ status: 'error', message: 'Internal tool error.' })
        }
      });
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
    } else if (data.event === 'media') {
        const audioAppend = {
            type: 'input_audio_buffer.append',
            audio: data.media.payload
        };
        this.sendToOpenAI(audioAppend);
    }
  }
}
