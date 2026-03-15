import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendEmailReport } from './emailService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
    const promptToUse = this.mode === 'outbound' ? prompts.SARAH_OUTBOUND : prompts.SARAH_INBOUND;

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
        instructions: promptToUse,
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Schedule a Technical Assessment for Internet, VoIP, or IT. Requires the Trifecta: contactName, companyName, confirmedPhone, appointmentTime.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the decision maker (IT Manager or Owner)" },
                companyName: { type: "string", description: "Name of the company to check fiber map" },
                confirmedPhone: { type: "string", description: "Verbally confirmed best phone number to reach them" },
                appointmentTime: { type: "string", description: "The exact requested date and time for the technical assessment" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Log an interaction if the lead is not interested, went to voicemail, or wants to be called later.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "The outcome: Not interested, Voicemail, Call back later" },
                notes: { type: "string", description: "Any additional context about the interaction" }
              },
              required: ["reason", "notes"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "Ends the call. Use this at the very end of the conversation after saying a polite goodbye.",
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

    // After configuring the session, if we are outbound we need Sarah to start speaking immediately
    if (this.mode === 'outbound') {
      setTimeout(() => {
        this.sendToOpenAI({
          type: 'response.create',
          response: {
            instructions: "Start the conversation immediately. Greet the person enthusiastically and ask if they are the one who manages the technology or if you should ask for an Office Manager."
          }
        });
      }, 500); // Slight delay to ensure config applies
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
        result = await this.scheduleAppointment(parsedArgs);
      } else if (name === 'report_interaction') {
        result = await this.reportInteraction(parsedArgs);
      } else if (name === 'end_call') {
        await this.endCall();
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

      // Trigger a response generation
      this.sendToOpenAI({ type: 'response.create' });

    } catch (error) {
      logger.error(`Error executing function ${name}:`, error);
    }
  }

  async scheduleAppointment(data) {
    logger.info(`Scheduling appointment: ${JSON.stringify(data)}`);
    const leadsPath = path.join(__dirname, '../data/leads.json');
    const leads = JSON.parse(fs.readFileSync(leadsPath, 'utf8'));

    const leadRecord = {
      ...data,
      twilioCallerId: this.callerId,
      callSid: this.callSid,
      timestamp: new Date().toISOString()
    };

    leads.push(leadRecord);
    fs.writeFileSync(leadsPath, JSON.stringify(leads, null, 2));

    await sendEmailReport('success', leadRecord);
    return { success: true, message: 'Appointment scheduled successfully.' };
  }

  async reportInteraction(data) {
    logger.info(`Reporting interaction: ${JSON.stringify(data)}`);
    const interactionsPath = path.join(__dirname, '../data/interactions.json');
    const interactions = JSON.parse(fs.readFileSync(interactionsPath, 'utf8'));

    const interactionRecord = {
      ...data,
      twilioCallerId: this.callerId,
      callSid: this.callSid,
      timestamp: new Date().toISOString()
    };

    interactions.push(interactionRecord);
    fs.writeFileSync(interactionsPath, JSON.stringify(interactions, null, 2));

    await sendEmailReport('report', interactionRecord);
    return { success: true, message: 'Interaction logged successfully.' };
  }

  async endCall() {
    logger.info(`Initiating end call sequence for ${this.callSid}`);

    // Command the bot to say a polite goodbye right before we set the timeout
    this.sendToOpenAI({
      type: 'response.create',
      response: {
        instructions: "Say a very brief, polite goodbye, and hang up."
      }
    });

    setTimeout(() => {
      logger.info(`10 second timeout reached. Closing socket for ${this.callSid}`);
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.close();
      }
    }, 10000);
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
