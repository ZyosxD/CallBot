import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LEADS_FILE = path.join(__dirname, '../data/leads.json');
const INTERACTIONS_FILE = path.join(__dirname, '../data/interactions.json');

const saveLead = (leadData) => {
  try {
    const data = fs.readFileSync(LEADS_FILE, 'utf8');
    const leads = JSON.parse(data);
    leads.push({ ...leadData, timestamp: new Date().toISOString() });
    fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
    logger.info('Lead saved successfully.');
  } catch (error) {
    logger.error('Error saving lead:', error);
  }
};

const saveInteraction = (interactionData) => {
  try {
    const data = fs.readFileSync(INTERACTIONS_FILE, 'utf8');
    const interactions = JSON.parse(data);
    interactions.push({ ...interactionData, timestamp: new Date().toISOString() });
    fs.writeFileSync(INTERACTIONS_FILE, JSON.stringify(interactions, null, 2));
    logger.info('Interaction saved successfully.');
  } catch (error) {
    logger.error('Error saving interaction:', error);
  }
};

export class OpenAIRealtimeService {
  constructor(ws, callSid, callerId, mode, clientId) {
    this.ws = ws;
    this.callSid = callSid;
    this.callerId = callerId;
    this.mode = mode;
    this.clientId = clientId;
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
    const systemInstruction = this.mode === 'outbound' ? prompts.SARAH_OUTBOUND : prompts.SARAH_INBOUND;

    // Add dynamic context if needed (e.g., Client Name)
    // But for now, we stick to the static prompt + caller context which we might inject via "First Message".
    // Or we can append to instructions.

    const sessionUpdate = {
      type: 'session.update',
      session: {
        turn_detection: {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 1500
        },
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        voice: 'coral', // Sarah's voice
        instructions: systemInstruction,
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: prompts.tools,
        tool_choice: "auto"
      },
    };
    this.sendToOpenAI(sessionUpdate);

    // Initial greeting trigger
    // OpenAI Realtime API doesn't speak first by default unless triggered.
    // We send a response.create with instructions to start.
    // For outbound, we might want to start immediately.
    // For inbound, we wait for user to speak or say hello.
    // But typically, a bot should greet.

    // Actually, memory says: "The OpenAIRealtimeService sends a `response.create` event with instructions to 'Start the conversation immediately' (with specific Spanish greeting text) upon connection to ensure the AI speaks first."
    // BUT the new spec is "Hi, do you handle..."

    // I'll add a response.create to trigger the first turn.
    setTimeout(() => {
        this.sendToOpenAI({
            type: 'response.create',
            response: {
                instructions: "Start the conversation immediately with the greeting defined in the script."
            }
        });
    }, 500);
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
        const appointmentData = {
            ...parsedArgs,
            callerId: this.callerId, // Add caller ID context
            clientId: this.clientId
        };
        saveLead(appointmentData);
        await sendSuccessEmail(appointmentData);
        result = { status: 'success', message: 'Appointment scheduled and email sent.' };
      } else if (name === 'report_interaction') {
        const reportData = {
            ...parsedArgs,
            callerId: this.callerId,
            clientId: this.clientId
        };
        saveInteraction(reportData);
        await sendReportEmail(reportData);
        result = { status: 'logged', message: 'Interaction reported.' };
      } else if (name === 'end_call') {
        // Handle end call
        logger.info('Ending call as requested by AI.');
        result = { status: 'ending' };

        // 10s delay then close
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

      // Trigger a response generation (especially for end_call to say goodbye)
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
