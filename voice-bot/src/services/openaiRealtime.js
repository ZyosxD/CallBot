import WebSocket from 'ws';
import { config } from '../config/config.js';
import { SARAH_INBOUND, SARAH_OUTBOUND } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import twilio from 'twilio';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LEADS_FILE = path.join(__dirname, '../data/leads.json');
const INTERACTIONS_FILE = path.join(__dirname, '../data/interactions.json');

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
    const instructions = this.mode === 'outbound' ? SARAH_OUTBOUND : SARAH_INBOUND;
    const sessionUpdate = {
      type: 'session.update',
      session: {
        turn_detection: { type: 'server_vad', threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 1500 },
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
            description: "Schedules a Technical Assessment when the client agrees and provides the complete Trifecta (contactName, companyName, confirmedPhone, appointmentTime).",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Who should we ask for?" },
                companyName: { type: "string", description: "Name of the company" },
                confirmedPhone: { type: "string", description: "Verbal confirmation of the best number to call" },
                appointmentTime: { type: "string", description: "Exact time for tomorrow's call" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Logs the interaction if the client is not interested, wants a callback later, or if reaching a voicemail.",
            parameters: {
              type: "object",
              properties: {
                status: { type: "string", description: "NOT_INTERESTED, CALL_LATER, VOICEMAIL" },
                reason: { type: "string", description: "Brief explanation" }
              },
              required: ["status", "reason"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "Ends the current call, saying goodbye and then hanging up.",
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

    const greeting = this.mode === 'outbound'
      ? 'Start the conversation immediately by greeting them, and asking if you are speaking to the person who handles the technology.'
      : 'Start the conversation immediately by greeting them, thanking them for calling 1Wire, and asking how you can help them with their Internet, VoIP, or IT needs today.';

    this.sendToOpenAI({
        type: 'response.create',
        response: {
            instructions: greeting
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
    const { name, arguments: args } = event;
    const parsedArgs = JSON.parse(args);
    const callId = event.call_id;

    logger.info(`Function call detected: ${name} with args: ${args}`);
    let result = null;

    try {
      if (name === 'schedule_appointment') {
        const lead = {
          ...parsedArgs,
          callerId: this.callerId,
          timestamp: new Date().toISOString()
        };
        const leads = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf-8'));
        leads.push(lead);
        fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
        await sendSuccessEmail(lead);
        result = { status: 'success' };
      } else if (name === 'report_interaction') {
        const interaction = {
          ...parsedArgs,
          callerId: this.callerId,
          timestamp: new Date().toISOString()
        };
        const interactions = JSON.parse(fs.readFileSync(INTERACTIONS_FILE, 'utf-8'));
        interactions.push(interaction);
        fs.writeFileSync(INTERACTIONS_FILE, JSON.stringify(interactions, null, 2));
        await sendReportEmail(interaction);
        result = { status: 'logged' };
      } else if (name === 'end_call') {
        result = { status: 'hanging_up' };

        const functionOutput = {
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: callId,
            output: JSON.stringify(result)
          }
        };
        this.sendToOpenAI(functionOutput);

        this.sendToOpenAI({
            type: 'response.create',
            response: {
                instructions: "Say a short, polite goodbye."
            }
        });

        setTimeout(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.close();
            }
        }, 10000);
        return;
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
      this.callSid = data.start.callSid;
      this.streamSid = data.start.streamSid;
      logger.info(`Stream started: ${this.streamSid} for CallSid: ${this.callSid}`);
    } else if (data.event === 'media') {
        const audioAppend = {
            type: 'input_audio_buffer.append',
            audio: data.media.payload
        };
        this.sendToOpenAI(audioAppend);
    }
  }
}
