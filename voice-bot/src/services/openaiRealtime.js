import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';
import { readJsonFile, writeJsonFile } from '../utils/fileHelper.js';
import twilio from 'twilio';

const LEADS_FILE = 'src/data/leads.json';
const INTERACTIONS_FILE = 'src/data/interactions.json';
const CLIENTS_FILE = 'src/data/clients.json';

export class OpenAIRealtimeService {
  constructor(ws, callSid, context = 'inbound', clientId = null) {
    this.ws = ws;
    this.callSid = callSid;
    this.context = context;
    this.clientId = clientId;
    this.openaiWs = null;
    this.streamSid = null;
    this.clientData = null;

    if (this.clientId) {
      const clients = readJsonFile(CLIENTS_FILE);
      this.clientData = clients.find(c => String(c.id) === String(this.clientId));
    }
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
    const sessionUpdate = {
      type: 'session.update',
      session: {
        turn_detection: { type: 'server_vad', silence_duration_ms: 1500 },
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        voice: 'coral',
        instructions: prompts.systemInstruction + (this.clientData ? `\n\nClient Info: ${JSON.stringify(this.clientData)}` : ''),
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Schedule a technical assessment when the user agrees.",
            parameters: {
              type: "object",
              properties: {
                name: { type: "string", description: "Contact Name" },
                company: { type: "string", description: "Company Name" },
                phone: { type: "string", description: "Verified Phone Number" },
                time: { type: "string", description: "Proposed Time (e.g. Tomorrow at 10am)" }
              },
              required: ["name", "company", "phone", "time"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report the outcome of the call if not scheduled (e.g. Not Interested, Busy, Voicemail).",
            parameters: {
              type: "object",
              properties: {
                outcome: { type: "string", enum: ["not_interested", "busy", "voicemail", "call_back_later", "other"] },
                notes: { type: "string", description: "Brief notes about the interaction." }
              },
              required: ["outcome"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call after saying goodbye.",
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
    let result = { status: 'success' };

    try {
      if (name === 'schedule_appointment') {
        const lead = {
          ...parsedArgs,
          clientId: this.clientId,
          originalClientData: this.clientData,
          timestamp: new Date().toISOString(),
          callSid: this.callSid
        };

        const leads = readJsonFile(LEADS_FILE);
        leads.push(lead);
        writeJsonFile(LEADS_FILE, leads);

        await sendSuccessEmail({
          name: lead.name,
          company: lead.company,
          phone: lead.phone,
          appointmentTime: lead.time,
          callerId: this.clientData ? this.clientData.phone : 'Unknown'
        });

        result = { message: "Appointment scheduled and email sent." };

      } else if (name === 'report_interaction') {
        const interaction = {
          ...parsedArgs,
          clientId: this.clientId,
          timestamp: new Date().toISOString(),
          callSid: this.callSid
        };

        const interactions = readJsonFile(INTERACTIONS_FILE);
        interactions.push(interaction);
        writeJsonFile(INTERACTIONS_FILE, interactions);

        await sendReportEmail({
          phone: this.clientData ? this.clientData.phone : 'Unknown',
          callerId: this.clientData ? this.clientData.phone : 'Unknown',
          outcome: interaction.outcome,
          notes: interaction.notes || 'No notes provided.'
        });

        result = { message: "Interaction reported." };
      } else if (name === 'end_call') {
        logger.info('End call requested by AI.');
        // Don't close immediately. Let the AI say goodbye (it might have generated audio before this tool call or alongside it).
        // Wait 10 seconds then close.
        setTimeout(() => {
          logger.info('Closing connection after 10s delay.');
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.close();
          }
          if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
            this.openaiWs.close();
          }
        }, 10000);

        result = { message: "Ending call in 10 seconds." };
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
