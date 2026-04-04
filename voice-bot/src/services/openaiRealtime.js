import WebSocket from 'ws';
import fs from 'fs/promises';
import path from 'path';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger from '../utils/logger.js';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';

const leadsFilePath = path.join(process.cwd(), 'src', 'data', 'leads.json');
const interactionsFilePath = path.join(process.cwd(), 'src', 'data', 'interactions.json');

export class OpenAIRealtimeService {
  constructor(ws, callSid, mode, callerId) {
    this.ws = ws;
    this.callSid = callSid;
    this.mode = mode;
    this.callerId = callerId;
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
      this.sendSessionUpdate();

      // Start the conversation
      this.sendToOpenAI({
        type: 'response.create',
        response: {
          instructions: 'Start the conversation immediately. Greet the user according to your system instructions.'
        }
      });
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
            description: "Schedule a Technical Assessment. Use this ONLY when you have collected all required information.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the person" },
                companyName: { type: "string", description: "Name of the company" },
                confirmedPhone: { type: "string", description: "The confirmed phone number" },
                appointmentTime: { type: "string", description: "The agreed upon time for the assessment tomorrow" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Log the interaction if the user is not interested, asks to call back later, or it's a voicemail.",
            parameters: {
              type: "object",
              properties: {
                outcome: { type: "string", enum: ["Not Interested", "Voicemail", "Call Back Later"], description: "The outcome of the call" },
                summary: { type: "string", description: "A brief summary of what happened" }
              },
              required: ["outcome"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call gracefully. Use this to hang up when the conversation is over.",
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

      if (event.type === 'response.audio.delta' && event.delta) {
        this.sendAudioToTwilio(event.delta);
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

    logger.info(`Function call detected: ${name}`);

    let parsedArgs = {};
    try {
      parsedArgs = JSON.parse(args);
    } catch (e) {
      logger.error(`Failed to parse arguments for ${name}: ${args}`, e);
      // Let it continue with empty args, or return error to OpenAI
    }

    let result = null;

    try {
      if (name === 'schedule_appointment') {
        const lead = {
          callerId: this.callerId,
          ...parsedArgs,
          timestamp: new Date().toISOString()
        };

        // Append to leads.json
        try {
          const leadsData = await fs.readFile(leadsFilePath, 'utf8');
          const leads = JSON.parse(leadsData);
          leads.push(lead);
          await fs.writeFile(leadsFilePath, JSON.stringify(leads, null, 2));
        } catch (e) {
          logger.error('Failed to update leads.json', e);
        }

        await sendSuccessEmail(parsedArgs, this.callerId);
        result = { status: 'success', message: 'Appointment scheduled successfully.' };

      } else if (name === 'report_interaction') {
        const interaction = {
          callerId: this.callerId,
          ...parsedArgs,
          timestamp: new Date().toISOString()
        };

        // Append to interactions.json
        try {
          const interactionsData = await fs.readFile(interactionsFilePath, 'utf8');
          const interactions = JSON.parse(interactionsData);
          interactions.push(interaction);
          await fs.writeFile(interactionsFilePath, JSON.stringify(interactions, null, 2));
        } catch (e) {
          logger.error('Failed to update interactions.json', e);
        }

        await sendReportEmail(parsedArgs, this.callerId);
        result = { status: 'success', message: 'Interaction logged.' };

      } else if (name === 'end_call') {
        logger.info(`Initiating end call sequence for ${this.callSid}`);
        result = { status: 'ending', message: 'Call will end shortly.' };

        // Instruct OpenAI to say goodbye
        this.sendToOpenAI({
          type: 'response.create',
          response: {
            instructions: 'Say a short, polite goodbye.'
          }
        });

        // Close after 10s
        setTimeout(() => {
          logger.info(`Closing sockets for call ${this.callSid} after delay.`);
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
              this.ws.close();
          }
          if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
              this.openaiWs.close();
          }
        }, 10000);
      }

      // Send function_call_output back to OpenAI
      const functionOutput = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify(result)
        }
      };
      this.sendToOpenAI(functionOutput);

      // We also trigger response.create for schedule_appointment or report_interaction so AI confirms
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
      this.streamSid = data.start.streamSid;
      this.callSid = data.start.callSid;
      this.isTwilioStarted = true;
      logger.info(`Stream started: ${this.streamSid} for CallSid: ${this.callSid}`);
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
