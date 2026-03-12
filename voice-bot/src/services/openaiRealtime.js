import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendEmailReport } from './emailService.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const leadsFilePath = path.join(__dirname, '../data/leads.json');
const interactionsFilePath = path.join(__dirname, '../data/interactions.json');

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
    const systemPrompt = this.mode === 'outbound' ? prompts.SARAH_OUTBOUND : prompts.SARAH_INBOUND;

    const sessionUpdate = {
      type: 'session.update',
      session: {
        turn_detection: { type: 'server_vad', silence_duration_ms: 1500 },
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        voice: 'coral',
        instructions: systemPrompt,
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Use this to schedule a technical assessment when the user agrees to it. You MUST have collected the Trifecta and Exact Time before calling this.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Who we should ask for." },
                companyName: { type: "string", description: "The name of the company." },
                confirmedPhone: { type: "string", description: "The phone number verbally confirmed by the user as the best number to reach them." },
                appointmentTime: { type: "string", description: "The exact time tomorrow for the appointment." }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Use this if the client is not interested, asks to call back later, or if you hit a voicemail.",
            parameters: {
              type: "object",
              properties: {
                outcome: { type: "string", description: "The outcome of the call (e.g., 'Not interested', 'Call back later', 'Voicemail')." },
                notes: { type: "string", description: "Any brief notes or context from the conversation." }
              },
              required: ["outcome"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "Use this to end the call naturally after you have finished speaking with the user and have already said your goodbye.",
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
    const greetingText = this.mode === 'outbound' ? 'Start the conversation immediately by asking for the person who handles technology.' : 'Start the conversation immediately by asking how you can help them today.';
    this.sendToOpenAI({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: greetingText }]
      }
    });
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
        const leadData = {
          id: Date.now(),
          callSid: this.callSid,
          callerId: this.callerId,
          ...parsedArgs
        };
        const leads = JSON.parse(fs.readFileSync(leadsFilePath, 'utf8'));
        leads.push(leadData);
        fs.writeFileSync(leadsFilePath, JSON.stringify(leads, null, 2));

        await sendEmailReport('SUCCESS', leadData);
        result = { status: 'success', message: 'Appointment scheduled successfully.' };
      } else if (name === 'report_interaction') {
        const interactionData = {
          id: Date.now(),
          callSid: this.callSid,
          callerId: this.callerId,
          ...parsedArgs
        };
        const interactions = JSON.parse(fs.readFileSync(interactionsFilePath, 'utf8'));
        interactions.push(interactionData);
        fs.writeFileSync(interactionsFilePath, JSON.stringify(interactions, null, 2));

        await sendEmailReport('REPORT', interactionData);
        result = { status: 'success', message: 'Interaction logged successfully.' };
      } else if (name === 'end_call') {
        // Handle closing sequence
        logger.info(`Ending call ${this.callSid} in 10 seconds...`);

        // Final goodbye response
        this.sendToOpenAI({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Say a short, polite goodbye.' }]
          }
        });
        this.sendToOpenAI({ type: 'response.create' });

        setTimeout(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.close();
          }
        }, 10000);

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

      // If we are not ending the call, trigger another response
      if (name !== 'end_call') {
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
      this.callSid = data.start.callSid || this.callSid;
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
