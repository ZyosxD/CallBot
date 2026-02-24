import WebSocket from 'ws';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LEADS_FILE = path.join(__dirname, '../data/leads.json');
const INTERACTIONS_FILE = path.join(__dirname, '../data/interactions.json');

export class OpenAIRealtimeService {
  constructor(ws, callSid) {
    this.ws = ws;
    this.callSid = callSid;
    this.openaiWs = null;
    this.streamSid = null;
    this.callerId = null; // Will be set from stream params
    this.clientName = null;
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
        turn_detection: {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 1500
        },
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        voice: 'coral',
        instructions: prompts.systemInstruction,
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: prompts.tools,
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
        // Start conversation
        this.sendToOpenAI({
            type: 'response.create',
            response: {
                instructions: "Start the conversation immediately. Introduce yourself as Sarah from 1Wire."
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

    logger.info(`Function call detected: ${name} with args: ${args}`);
    let result = null;

    try {
      if (name === 'schedule_appointment') {
        result = await this.handleScheduleAppointment(parsedArgs);
      } else if (name === 'report_interaction') {
        result = await this.handleReportInteraction(parsedArgs);
      } else if (name === 'end_call') {
        result = await this.handleEndCall(parsedArgs);
      }

      // Send result back to OpenAI
      const functionOutput = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify(result || { status: 'ok' })
        }
      };
      this.sendToOpenAI(functionOutput);

      if (name !== 'end_call') {
          // Trigger a response generation if not ending call
          this.sendToOpenAI({ type: 'response.create' });
      }

    } catch (error) {
      logger.error(`Error executing function ${name}:`, error);
    }
  }

  async handleScheduleAppointment(args) {
      // Save to leads.json
      const lead = {
          ...args,
          callSid: this.callSid,
          callerId: this.callerId,
          timestamp: new Date().toISOString()
      };
      await this.appendToFile(LEADS_FILE, lead);

      // Send email
      await sendSuccessEmail({ name: args.companyName, phone: this.callerId }, args);

      return { status: 'scheduled', message: 'Appointment scheduled successfully.' };
  }

  async handleReportInteraction(args) {
      // Save to interactions.json
      const interaction = {
          ...args,
          callSid: this.callSid,
          callerId: this.callerId,
          timestamp: new Date().toISOString()
      };
      await this.appendToFile(INTERACTIONS_FILE, interaction);

      // Send email
      await sendReportEmail({ name: this.clientName || 'Unknown', phone: this.callerId }, args);

      return { status: 'reported', message: 'Interaction reported.' };
  }

  async handleEndCall(args) {
      logger.info('End call requested via tool');
      // Wait 10 seconds before closing
      setTimeout(() => {
          logger.info('Closing connection after 10s delay');
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
              this.ws.close();
          }
          if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
              this.openaiWs.close();
          }
      }, 10000);
      return { status: 'ending', message: 'Goodbye.' };
  }

  async appendToFile(filePath, data) {
      try {
          const content = await fs.readFile(filePath, 'utf8');
          const json = JSON.parse(content);
          json.push(data);
          await fs.writeFile(filePath, JSON.stringify(json, null, 2));
      } catch (error) {
          logger.error(`Error writing to ${filePath}:`, error);
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
      // Extract custom parameters
      if (data.start.customParameters) {
          this.callerId = data.start.customParameters.callerId;
          this.clientName = data.start.customParameters.clientName;
          logger.info(`Call started with CallerID: ${this.callerId}, Client: ${this.clientName}`);
      }
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
