import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendReportEmail } from './emailService.js';
import fs from 'fs';
import path from 'path';

const leadsPath = path.join(process.cwd(), 'src', 'data', 'leads.json');
const interactionsPath = path.join(process.cwd(), 'src', 'data', 'interactions.json');

const appendData = (filePath, data) => {
    try {
        let currentData = [];
        if (fs.existsSync(filePath)) {
            const fileContent = fs.readFileSync(filePath, 'utf8');
            if (fileContent) {
                currentData = JSON.parse(fileContent);
            }
        }
        currentData.push({ ...data, timestamp: new Date().toISOString() });
        fs.writeFileSync(filePath, JSON.stringify(currentData, null, 2));
    } catch (error) {
        logger.error(`Error writing to ${filePath}:`, error);
    }
};

export class OpenAIRealtimeService {
  constructor(ws, mode, callerId) {
    this.ws = ws;
    this.mode = mode || 'inbound';
    this.callerId = callerId || 'unknown';
    this.callSid = null;
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
          logger.info('Both OpenAI and Twilio are ready. Initializing session...');
          this.sendSessionUpdate();
      }
  }

  sendSessionUpdate() {
    const systemPrompt = this.mode === 'outbound' ? prompts.SARAH_OUTBOUND : prompts.SARAH_INBOUND;

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
        instructions: systemPrompt,
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Schedule a Technical Assessment when the client agrees.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the person" },
                companyName: { type: "string", description: "Name of the company" },
                confirmedPhone: { type: "string", description: "Verbal confirmation of the best phone number to call" },
                appointmentTime: { type: "string", description: "Exact time for the appointment tomorrow" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Log interaction if client is not interested, asks to call back later, or reaches a voicemail.",
            parameters: {
              type: "object",
              properties: {
                outcome: { type: "string", description: "E.g., 'Not interested', 'Call back later', 'Voicemail'" },
                notes: { type: "string", description: "Any additional context" }
              },
              required: ["outcome"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call after the conversation is fully concluded. Use this to say goodbye.",
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

    // Prompt the AI to start speaking immediately
    const greetingText = this.mode === 'outbound'
        ? "Hello, this is Sarah from 1Wire Assistant. Are you the one who handles the technology, or should I ask for the Office Manager?"
        : "Hello, this is Sarah, the 1Wire Assistant. How can I help you today?";

    this.sendToOpenAI({
        type: 'conversation.item.create',
        item: {
            type: 'message',
            role: 'system',
            content: [{ type: 'input_text', text: `Start the conversation immediately with: "${greetingText}"` }]
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
    const callId = event.call_id;

    logger.info(`Function call detected: ${name} with args: ${args}`);
    let result = null;

    try {
      let parsedArgs = {};
      try {
          parsedArgs = JSON.parse(args);
      } catch (parseError) {
          logger.error('SyntaxError parsing function arguments:', parseError);
          parsedArgs = {}; // Fallback
      }

      if (name === 'schedule_appointment') {
        const leadData = {
            callerId: this.callerId,
            ...parsedArgs
        };
        appendData(leadsPath, leadData);
        await sendReportEmail('SUCCESS', leadData);
        result = { status: 'appointment_scheduled_successfully' };
      } else if (name === 'report_interaction') {
        const interactionData = {
            callerId: this.callerId,
            ...parsedArgs
        };
        appendData(interactionsPath, interactionData);
        await sendReportEmail('REPORT', interactionData);
        result = { status: 'interaction_logged' };
      } else if (name === 'end_call') {
        result = { status: 'ending_call' };

        // Send output back to avoid model hanging
        this.sendToOpenAI({
            type: 'conversation.item.create',
            item: {
                type: 'function_call_output',
                call_id: callId,
                output: JSON.stringify(result)
            }
        });

        // Trigger a response generation for a goodbye message before closing
        this.sendToOpenAI({
            type: 'conversation.item.create',
            item: {
                type: 'message',
                role: 'system',
                content: [{ type: 'input_text', text: 'Say a short, polite goodbye.' }]
            }
        });
        this.sendToOpenAI({ type: 'response.create' });

        logger.info(`Ending call for ${this.callSid} in 10 seconds...`);
        setTimeout(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.close();
            }
            if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
                this.openaiWs.close();
            }
        }, 10000);

        return; // Early return because we already handled output
      }

      // Send result back to OpenAI for other functions
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
      // Send error back to prevent model hanging
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
      this.callSid = data.start.callSid;
      logger.info(`Stream started: ${this.streamSid} for CallSid: ${this.callSid}`);

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
