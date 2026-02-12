import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { addLead, logInteraction, getClients } from './leadService.js';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';
import twilio from 'twilio';

const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

export class OpenAIRealtimeService {
  constructor(ws, callSid, clientId) {
    this.ws = ws;
    this.callSid = callSid;
    this.clientId = clientId;
    this.openaiWs = null;
    this.streamSid = null;
    this.clientData = null;
  }

  async loadClientData() {
    if (this.clientId) {
        const clients = await getClients();
        this.clientData = clients.find(c => c.id == this.clientId);
    }
  }

  async connect() {
    await this.loadClientData();

    try {
      this.openaiWs = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01', {
        headers: {
          'Authorization': `Bearer ${config.openai.apiKey}`,
          'OpenAI-Beta': 'realtime=v1',
        },
      });

      this.openaiWs.on('open', () => {
        logger.info(`Connected to OpenAI Realtime API for Call ${this.callSid}`);
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
    const sessionUpdate = {
      type: 'session.update',
      session: {
        turn_detection: { type: 'server_vad', threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 1500 },
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        voice: 'coral',
        instructions: prompts.systemInstruction + (this.clientData ? `\n\nYou are calling ${this.clientData.name}. Contact person: ${this.clientData.contact}.` : ''),
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Schedule a Technical Assessment after collecting the Trifecta data.",
            parameters: {
              type: "object",
              properties: {
                name: { type: "string", description: "Name of the contact person" },
                company: { type: "string", description: "Name of the company" },
                verbalPhone: { type: "string", description: "The phone number confirmed verbally" },
                date: { type: "string", description: "Date of appointment (e.g. tomorrow)" },
                time: { type: "string", description: "Time of appointment" },
                needs: { type: "string", description: "Summary of pain points/needs" }
              },
              required: ["name", "company", "verbalPhone", "date", "time", "needs"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report the interaction if not interested, busy, or voicemail.",
            parameters: {
              type: "object",
              properties: {
                outcome: { type: "string", description: "Outcome of the call (e.g. Not Interested, Voicemail, Call Back Later)" },
                notes: { type: "string", description: "Any relevant notes" }
              },
              required: ["outcome"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call gracefully.",
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
    const { name, arguments: args } = event;
    const parsedArgs = JSON.parse(args);
    const callId = event.call_id;

    logger.info(`Function call detected: ${name} with args: ${args}`);
    let result = { success: true };

    try {
      if (name === 'schedule_appointment') {
        const lead = {
            ...parsedArgs,
            callerId: this.clientData ? this.clientData.phone : 'Unknown', // Or get from callSid if possible, but clientData is safer
            clientId: this.clientId
        };
        await addLead(lead);
        await sendSuccessEmail(lead);
        result = { status: 'scheduled' };

      } else if (name === 'report_interaction') {
        const interaction = {
            ...parsedArgs,
            name: this.clientData ? this.clientData.contact : 'Unknown',
            company: this.clientData ? this.clientData.name : 'Unknown',
            callerId: this.clientData ? this.clientData.phone : 'Unknown',
            clientId: this.clientId
        };
        await logInteraction(interaction);
        await sendReportEmail(interaction);
        result = { status: 'reported' };

      } else if (name === 'end_call') {
        logger.info('Tool end_call invoked. Waiting 10s to hang up.');
        setTimeout(() => {
            this.hangUp();
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

      // Trigger a response generation (e.g. to say goodbye if not ended yet)
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
      logger.info(`Stream started: ${this.streamSid}`);
    } else if (data.event === 'media') {
        const audioAppend = {
            type: 'input_audio_buffer.append',
            audio: data.media.payload
        };
        this.sendToOpenAI(audioAppend);
    }
  }

  hangUp() {
    logger.info(`Hanging up call ${this.callSid}`);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.close();
    }
    if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
        this.openaiWs.close();
    }
    // Also use Twilio API to ensure call is killed?
    // Usually closing the WebSocket terminates the stream, but the call might stay open?
    // Twilio <Stream> ends when WebSocket closes.
    // So this should be enough.
  }
}
