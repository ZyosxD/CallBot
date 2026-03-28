import WebSocket from 'ws';
import fs from 'fs/promises';
import path from 'path';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';

const leadsPath = path.resolve('src/data/leads.json');
const interactionsPath = path.resolve('src/data/interactions.json');

export class OpenAIRealtimeService {
  constructor(ws, callSid, callerId, mode) {
    this.ws = ws;
    this.callSid = callSid;
    this.callerId = callerId;
    this.mode = mode;
    this.openaiWs = null;
    this.streamSid = null;
    this.isActive = true;
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
        turn_detection: { type: 'server_vad', silence_duration_ms: 1500 },
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
            description: "Schedule a Technical Assessment appointment. Requires contactName, companyName, confirmedPhone, and appointmentTime.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string" },
                companyName: { type: "string" },
                confirmedPhone: { type: "string" },
                appointmentTime: { type: "string" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Log the interaction if the client is not interested, asks to call back later, or it goes to voicemail.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Reason for the report, e.g., not interested, voicemail, call back later." },
                notes: { type: "string", description: "Any additional details gathered." }
              },
              required: ["reason"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "Ends the call politely. Call this function at the very end of the conversation.",
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
    if (!this.isActive) return;

    try {
      const event = JSON.parse(data);

      if (event.type === 'session.created') {
        logger.info('OpenAI Session Created');
        // Tell the AI to speak first
        this.sendToOpenAI({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Start the conversation immediately by greeting me.' }]
          }
        });
        this.sendToOpenAI({ type: 'response.create' });
      }

      if (event.type === 'response.audio.delta' && event.delta) {
        this.sendAudioToTwilio(event.delta);
      }

      if (event.type === 'response.audio_transcript.done') {
          logConversation(this.callSid, 'Sarah', event.transcript);
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
        let leads = [];
        try {
          const leadsData = await fs.readFile(leadsPath, 'utf8');
          leads = JSON.parse(leadsData);
        } catch (e) {
          logger.warn('Could not read leads.json, starting fresh.');
        }

        const newLead = {
          ...parsedArgs,
          originalCallerId: this.callerId,
          timestamp: new Date().toISOString()
        };
        leads.push(newLead);
        await fs.writeFile(leadsPath, JSON.stringify(leads, null, 2));

        // Send Email
        await sendSuccessEmail(parsedArgs, this.callerId, parsedArgs.confirmedPhone);

        result = { status: 'success', message: 'Appointment scheduled and email sent.' };

      } else if (name === 'report_interaction') {
        let interactions = [];
        try {
          const interactionsData = await fs.readFile(interactionsPath, 'utf8');
          interactions = JSON.parse(interactionsData);
        } catch (e) {
           logger.warn('Could not read interactions.json, starting fresh.');
        }

        const newInteraction = {
          ...parsedArgs,
          originalCallerId: this.callerId,
          timestamp: new Date().toISOString()
        };
        interactions.push(newInteraction);
        await fs.writeFile(interactionsPath, JSON.stringify(interactions, null, 2));

        // Send Email
        await sendReportEmail(newInteraction, this.callerId);

        result = { status: 'success', message: 'Interaction reported.' };

      } else if (name === 'end_call') {
        result = { status: 'success', message: 'Goodbye initiated.' };

        // Final response back to model to close function so it doesn't hang
        this.sendToOpenAI({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: callId,
            output: JSON.stringify(result)
          }
        });

        // Tell model to say goodbye
        this.sendToOpenAI({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Say a short polite goodbye now, then stop speaking.' }]
          }
        });
        this.sendToOpenAI({ type: 'response.create' });

        logger.info(`Ending call ${this.callSid} in 10 seconds...`);
        this.isActive = false; // Prevent further interactions
        setTimeout(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.close();
          }
          if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
            this.openaiWs.close();
          }
        }, 10000);
        return; // Return early because we handled the output manually
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
      this.callSid = data.start.callSid || this.callSid; // Update from stream if available
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
