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
  constructor(ws, callSid, callerId, mode = 'inbound') {
    this.ws = ws;
    this.callSid = callSid;
    this.callerId = callerId;
    this.mode = mode; // 'inbound' or 'outbound'
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
          this.sessionInitialized = true;
          this.sendSessionUpdate();
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
            description: "Schedule a technical assessment after the client agrees.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Who should we ask for?" },
                companyName: { type: "string", description: "Needed to check the fiber map" },
                confirmedPhone: { type: "string", description: "Verbally confirmed best number to call" },
                appointmentTime: { type: "string", description: "Exact time for the assessment tomorrow" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Log interaction if the client is not interested, wants a callback later, or reached voicemail.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Reason for reporting (e.g., Not interested, Voicemail, Callback later)" },
                notes: { type: "string", description: "Any additional notes from the conversation" }
              },
              required: ["reason"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call politely.",
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

    // Make the AI speak first
    this.sendToOpenAI({
        type: 'response.create',
        response: {
            instructions: "Start the conversation immediately. Say exactly: 'Hi, is this the person who manages the technology or should I ask for an Office Manager?'"
        }
    });
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
    } catch (e) {
        logger.error(`Error parsing JSON arguments for ${name}:`, e);
        const functionOutput = {
            type: 'conversation.item.create',
            item: {
                type: 'function_call_output',
                call_id: callId,
                output: JSON.stringify({ error: "Invalid JSON arguments" })
            }
        };
        this.sendToOpenAI(functionOutput);
        this.sendToOpenAI({ type: 'response.create' });
        return;
    }

    let result = null;

    try {
      if (name === 'schedule_appointment') {
          try {
              const leadsData = await fs.readFile(LEADS_FILE, 'utf8');
              const leads = JSON.parse(leadsData);
              leads.push({ ...parsedArgs, callerId: this.callerId, timestamp: new Date().toISOString() });
              await fs.writeFile(LEADS_FILE, JSON.stringify(leads, null, 2), 'utf8');
          } catch(e) { logger.error('Error saving lead', e); }

          await sendReportEmail({
              type: 'SUCCESS',
              callerId: this.callerId,
              confirmedPhone: parsedArgs.confirmedPhone,
              data: parsedArgs
          });
          result = { status: 'success', message: 'Appointment scheduled and email sent.' };

      } else if (name === 'report_interaction') {
          try {
              const interactionsData = await fs.readFile(INTERACTIONS_FILE, 'utf8');
              const interactions = JSON.parse(interactionsData);
              interactions.push({ ...parsedArgs, callerId: this.callerId, timestamp: new Date().toISOString() });
              await fs.writeFile(INTERACTIONS_FILE, JSON.stringify(interactions, null, 2), 'utf8');
          } catch(e) { logger.error('Error saving interaction', e); }

          await sendReportEmail({
              type: 'REPORT',
              callerId: this.callerId,
              confirmedPhone: null,
              data: parsedArgs
          });
          result = { status: 'success', message: 'Interaction logged and email sent.' };

      } else if (name === 'end_call') {
          result = { status: 'success', message: 'Ending call in 10 seconds.' };

          this.sendToOpenAI({
              type: 'response.create',
              response: {
                  instructions: "Say a short, polite goodbye."
              }
          });

          setTimeout(() => {
              if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                  logger.info(`Closing Twilio websocket for ${this.callSid} after delay.`);
                  this.ws.close();
              }
          }, 10000);
      }

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
          this.sendToOpenAI({ type: 'response.create' });
      }

    } catch (error) {
      logger.error(`Error executing function ${name}:`, error);
      const errorOutput = {
          type: 'conversation.item.create',
          item: {
              type: 'function_call_output',
              call_id: callId,
              output: JSON.stringify({ error: error.message })
          }
      };
      this.sendToOpenAI(errorOutput);
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
