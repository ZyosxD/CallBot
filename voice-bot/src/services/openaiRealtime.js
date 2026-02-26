import WebSocket from 'ws';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LEADS_FILE = path.join(__dirname, '../data/leads.json');
const INTERACTIONS_FILE = path.join(__dirname, '../data/interactions.json');

export class OpenAIRealtimeService {
  constructor(ws, callSid, callerId) {
    this.ws = ws;
    this.callSid = callSid;
    this.callerId = callerId || 'Unknown Client';
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
    const sessionUpdate = {
      type: 'session.update',
      session: {
        turn_detection: { type: 'server_vad', silence_duration_ms: 1500 },
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        voice: 'coral',
        instructions: prompts.systemInstruction,
        modalities: ["text", "audio"],
        temperature: 0.6,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Schedule a technical assessment when the user agrees.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the person to contact" },
                companyName: { type: "string", description: "Name of the company" },
                confirmedPhone: { type: "string", description: "Confirmed phone number" },
                appointmentTime: { type: "string", description: "Proposed time for the call" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report the outcome of the call if not interested or requires callback.",
            parameters: {
              type: "object",
              properties: {
                outcome: { type: "string", enum: ["NOT_INTERESTED", "CALLBACK_LATER", "VOICEMAIL", "GATEKEEPER_BLOCK"], description: "The outcome of the call" },
                notes: { type: "string", description: "Any relevant notes or reasons" }
              },
              required: ["outcome", "notes"]
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
  }

  async handleOpenAIMessage(data) {
    try {
      const event = JSON.parse(data);

      if (event.type === 'session.created') {
        logger.info('OpenAI Session Created');
        // Trigger the conversation start
        this.sendToOpenAI({
            type: 'response.create',
            response: {
                instructions: "Start the conversation immediately with the greeting from the script."
            }
        });
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

    logger.info(`Function call detected: ${name}`);
    let result = { status: 'success' };

    try {
      if (name === 'schedule_appointment') {
        // Save lead
        const lead = { ...parsedArgs, callSid: this.callSid, timestamp: new Date().toISOString() };
        await this.saveData(LEADS_FILE, lead);

        // Send Email
        await sendSuccessEmail({ ...parsedArgs, callerId: this.callerId });

        result = { message: "Appointment scheduled and email sent." };

      } else if (name === 'report_interaction') {
        // Save interaction
        const interaction = { ...parsedArgs, callSid: this.callSid, callerId: this.callerId, timestamp: new Date().toISOString() };
        await this.saveData(INTERACTIONS_FILE, interaction);

        // Send Email
        await sendReportEmail({ ...parsedArgs, callerId: this.callerId });

        result = { message: "Interaction reported." };

      } else if (name === 'end_call') {
        logger.info('End call requested by AI.');

        // Wait 10 seconds before closing to allow audio to finish
        setTimeout(() => {
            if (this.ws) this.ws.close();
            if (this.openaiWs) this.openaiWs.close();
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

      // Trigger a response generation if not ending
      if (name !== 'end_call') {
          this.sendToOpenAI({ type: 'response.create' });
      }

    } catch (error) {
      logger.error(`Error executing function ${name}:`, error);
    }
  }

  async saveData(filePath, data) {
      try {
          const fileContent = await fs.readFile(filePath, 'utf-8');
          const json = JSON.parse(fileContent);
          json.push(data);
          await fs.writeFile(filePath, JSON.stringify(json, null, 2));
      } catch (error) {
          logger.error(`Error saving data to ${filePath}:`, error);
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
      // Extract custom parameters if available
      // The 'callerId' will be passed in start.customParameters.callerId
      if (data.start.customParameters && data.start.customParameters.callerId) {
          this.callerId = data.start.customParameters.callerId;
      }
      logger.info(`Stream started: ${this.streamSid} for CallerID: ${this.callerId} (CallSid: ${this.callSid})`);
    } else if (data.event === 'media') {
        const audioAppend = {
            type: 'input_audio_buffer.append',
            audio: data.media.payload
        };
        this.sendToOpenAI(audioAppend);
    }
  }
}
