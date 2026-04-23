import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';
import fs from 'fs/promises';
import path from 'path';

const LEADS_FILE = path.join(process.cwd(), 'src', 'data', 'leads.json');
const INTERACTIONS_FILE = path.join(process.cwd(), 'src', 'data', 'interactions.json');

export class OpenAIRealtimeService {
  constructor(ws, callSid, callerId, mode) {
    this.ws = ws;
    this.callSid = callSid;
    this.callerId = callerId;
    this.mode = mode;
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
        this.isOpenAiConnected = false;
      });

    } catch (error) {
      logger.error('Error connecting to OpenAI:', error);
    }
  }

  checkAndInitializeSession() {
      if (this.isOpenAiConnected && this.isTwilioStarted && !this.sessionInitialized) {
          this.sendSessionUpdate();
          this.sessionInitialized = true;
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
            description: "Trigger this to schedule an appointment when you have collected the Trifecta (Contact Name, Company Name, Confirmed Phone) and Exact Time.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Who should we ask for?" },
                companyName: { type: "string", description: "Name of the company" },
                confirmedPhone: { type: "string", description: "The confirmed best phone number to call back" },
                appointmentTime: { type: "string", description: "The exact time for the appointment" },
                notes: { type: "string", description: "Any additional notes" }
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
                status: { type: "string", description: "Reason for reporting (e.g. Not interested, Voicemail, Call back later)" },
                confirmedPhone: { type: "string", description: "The confirmed phone number if obtained" },
                notes: { type: "string", description: "Brief notes about the interaction" }
              },
              required: ["status"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "Trigger this at the very end of the conversation after a polite goodbye.",
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
    const { name, arguments: args, call_id: callId } = event;
    logger.info(`Function call detected: ${name} with args: ${args}`);

    let parsedArgs;
    try {
        parsedArgs = JSON.parse(args);
    } catch (error) {
        logger.error(`Error parsing JSON arguments for function ${name}:`, error);
        return; // Early return to avoid crash
    }

    let result = null;

    try {
      if (name === 'schedule_appointment') {
          const leadData = {
              ...parsedArgs,
              callerId: this.callerId,
              callSid: this.callSid,
              mode: this.mode,
              timestamp: new Date().toISOString()
          };

          try {
              const data = await fs.readFile(LEADS_FILE, 'utf-8');
              let leads = JSON.parse(data);
              leads.push(leadData);
              await fs.writeFile(LEADS_FILE, JSON.stringify(leads, null, 2));
              await sendSuccessEmail(leadData);
              result = { success: true };
          } catch(err) {
              logger.error('Error writing lead data:', err);
              result = { success: false, error: err.message };
          }
      } else if (name === 'report_interaction') {
          const interactionData = {
              ...parsedArgs,
              callerId: this.callerId,
              callSid: this.callSid,
              mode: this.mode,
              timestamp: new Date().toISOString()
          };

          try {
              const data = await fs.readFile(INTERACTIONS_FILE, 'utf-8');
              let interactions = JSON.parse(data);
              interactions.push(interactionData);
              await fs.writeFile(INTERACTIONS_FILE, JSON.stringify(interactions, null, 2));
              await sendReportEmail(interactionData);
              result = { success: true };
          } catch(err) {
              logger.error('Error writing interaction data:', err);
              result = { success: false, error: err.message };
          }
      } else if (name === 'end_call') {
          result = { status: 'ending_call' };

          // Send function call output immediately so the AI doesn't hang
          const functionOutput = {
            type: 'conversation.item.create',
            item: {
              type: 'function_call_output',
              call_id: callId,
              output: JSON.stringify(result)
            }
          };
          this.sendToOpenAI(functionOutput);

          // Force a goodbye message
          this.sendToOpenAI({
              type: 'response.create',
              response: {
                  instructions: "Say a short, polite goodbye."
              }
          });

          // Wait 10 seconds before closing socket
          setTimeout(() => {
              if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                  this.ws.close();
              }
          }, 10000);

          return; // Skip the generic functionOutput send below
      }

      // Send result back to OpenAI for schedule_appointment and report_interaction
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