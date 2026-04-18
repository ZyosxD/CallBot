import WebSocket from 'ws';
import fs from 'fs/promises';
import path from 'path';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendReportEmail } from './emailService.js';

const LEADS_FILE = path.join(process.cwd(), 'src', 'data', 'leads.json');
const INTERACTIONS_FILE = path.join(process.cwd(), 'src', 'data', 'interactions.json');

export class OpenAIRealtimeService {
  constructor(ws) {
    this.ws = ws;
    this.callSid = 'unknown';
    this.mode = 'inbound';
    this.callerId = 'unknown';
    this.openaiWs = null;
    this.streamSid = null;
    this.isOpenAiConnected = false;
    this.isTwilioStarted = false;
    this.sessionInitialized = false;
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
      if (this.isOpenAiConnected && this.isTwilioStarted && !this.sessionInitialized) {
          this.sessionInitialized = true;
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
            threshold: 0.5,
            prefix_padding_ms: 300,
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
            description: "Trigger this when you have successfully collected the Trifecta and Exact Time from the client to schedule a technical assessment.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Who do we ask for?" },
                companyName: { type: "string", description: "Company name (mandatory)" },
                confirmedPhone: { type: "string", description: "Is this the best number to call?" },
                appointmentTime: { type: "string", description: "What time tomorrow?" },
                notes: { type: "string", description: "Any other details collected" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Trigger this when the client is not interested, asks to call back later, or it's a voicemail.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Reason for interaction report (e.g., Not interested, Call back later, Voicemail)" },
                notes: { type: "string", description: "Any other details collected" }
              },
              required: ["reason"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "Trigger this at the very end of the conversation to hang up the call.",
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

    // Initial greeting response instruction
    const initialGreeting = {
        type: 'response.create',
        response: {
            instructions: "Start the conversation immediately. Introduce yourself briefly."
        }
    };
    this.sendToOpenAI(initialGreeting);
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
    let parsedArgs = {};

    logger.info(`Function call detected: ${name} with args: ${args}`);

    try {
        parsedArgs = JSON.parse(args);
    } catch (e) {
        logger.error(`SyntaxError parsing tool arguments for ${name}:`, e);
        // Fallback for malformed JSON hallucinations
        parsedArgs = {};
    }

    let result = null;

    try {
      if (name === 'schedule_appointment') {
          const lead = {
              id: Date.now().toString(),
              callSid: this.callSid,
              callerId: this.callerId,
              ...parsedArgs,
              timestamp: new Date().toISOString()
          };

          let leads = [];
          try {
              const fileData = await fs.readFile(LEADS_FILE, 'utf-8');
              leads = JSON.parse(fileData);
          } catch (e) { /* ignore */ }

          leads.push(lead);
          await fs.writeFile(LEADS_FILE, JSON.stringify(leads, null, 2));

          await sendReportEmail('success', lead);
          result = { status: 'appointment_scheduled' };

      } else if (name === 'report_interaction') {
          const interaction = {
              id: Date.now().toString(),
              callSid: this.callSid,
              callerId: this.callerId,
              ...parsedArgs,
              timestamp: new Date().toISOString()
          };

          let interactions = [];
          try {
              const fileData = await fs.readFile(INTERACTIONS_FILE, 'utf-8');
              interactions = JSON.parse(fileData);
          } catch (e) { /* ignore */ }

          interactions.push(interaction);
          await fs.writeFile(INTERACTIONS_FILE, JSON.stringify(interactions, null, 2));

          await sendReportEmail('report', interaction);
          result = { status: 'interaction_logged' };

      } else if (name === 'end_call') {
          result = { status: 'ending_call_in_10s' };

          // Must resolve the function call before hanging up
          const functionOutput = {
            type: 'conversation.item.create',
            item: {
              type: 'function_call_output',
              call_id: callId,
              output: JSON.stringify(result)
            }
          };
          this.sendToOpenAI(functionOutput);

          // Send final goodbye instruction
          this.sendToOpenAI({
              type: 'response.create',
              response: {
                  instructions: "Say a short, polite goodbye right now."
              }
          });

          setTimeout(() => {
              logger.info(`Ending call for ${this.callSid} after 10s delay`);
              if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                  this.ws.close();
              }
              if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
                  this.openaiWs.close();
              }
          }, 10000);

          return; // Early return to prevent second functionOutput send
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

      const functionOutput = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify({ error: error.message })
        }
      };
      this.sendToOpenAI(functionOutput);
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
      this.isTwilioStarted = true;
      logger.info(`Stream started: ${this.streamSid}`);
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