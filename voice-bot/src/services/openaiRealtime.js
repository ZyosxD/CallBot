import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import twilio from 'twilio';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const leadsPath = path.join(__dirname, '../data/leads.json');
const interactionsPath = path.join(__dirname, '../data/interactions.json');

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
            description: "Schedule a Technical Assessment when the client agrees and provides The Trifecta + exact time.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the person handling IT/Owner" },
                companyName: { type: "string", description: "Company name" },
                confirmedPhone: { type: "string", description: "Best contact phone number verbally confirmed" },
                appointmentTime: { type: "string", description: "Exact time requested for tomorrow" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Log an interaction if the client is not interested, asks to call back later, or if the call goes to voicemail.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Reason why the appointment was not scheduled" }
              },
              required: ["reason"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call and disconnect after the conversation naturally concludes.",
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

    // Prompt initial greeting for outbound
    if (this.mode === 'outbound') {
      setTimeout(() => {
        this.sendToOpenAI({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'system',
            content: [{ type: 'input_text', text: 'Start the conversation immediately. Introduce yourself and ask if they handle the technology or if you should ask for an Office Manager.' }]
          }
        });
        this.sendToOpenAI({ type: 'response.create' });
      }, 500);
    }
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
        const leadData = {
          ...parsedArgs,
          originalCallerId: this.callerId,
          timestamp: new Date().toISOString()
        };

        const leads = JSON.parse(fs.readFileSync(leadsPath, 'utf8'));
        leads.push(leadData);
        fs.writeFileSync(leadsPath, JSON.stringify(leads, null, 2));

        await sendSuccessEmail(leadData);
        result = { status: 'appointment_scheduled' };
      }
      else if (name === 'report_interaction') {
        const reportData = {
          reason: parsedArgs.reason,
          originalCallerId: this.callerId,
          timestamp: new Date().toISOString()
        };

        const interactions = JSON.parse(fs.readFileSync(interactionsPath, 'utf8'));
        interactions.push(reportData);
        fs.writeFileSync(interactionsPath, JSON.stringify(interactions, null, 2));

        await sendReportEmail(reportData);
        result = { status: 'interaction_reported' };
      }
      else if (name === 'end_call') {
        logger.info(`Ending call ${this.callSid} in 10 seconds...`);
        setTimeout(async () => {
            const client = twilio(config.twilio.accountSid, config.twilio.authToken);
            try {
                await client.calls(this.callSid).update({ status: 'completed' });
                if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.close();
                if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) this.openaiWs.close();
            } catch (err) {
                logger.error('Error hanging up Twilio call:', err);
            }
        }, 10000);

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
          this.sendToOpenAI({
              type: 'conversation.item.create',
              item: {
                  type: 'message',
                  role: 'system',
                  content: [{ type: 'input_text', text: 'Say a short, polite goodbye.' }]
              }
          });
      }

      // Trigger a response generation
      this.sendToOpenAI({ type: 'response.create' });

    } catch (error) {
      logger.error(`Error executing function ${name}:`, error);
      // Optionally send error back
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
      this.callSid = data.start.callSid;
      this.streamSid = data.start.streamSid;

      const customParameters = data.start.customParameters || {};
      this.callerId = customParameters.callerId || this.callerId;
      this.mode = customParameters.mode || this.mode;

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
