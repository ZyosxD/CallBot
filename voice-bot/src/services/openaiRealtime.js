import WebSocket from 'ws';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendReport } from './emailService.js';

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
    this.context = {};
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
    // Determine instruction based on context (default to outbound/cold caller if not specified)
    // If context.mode is 'inbound', use inbound prompt.
    // Drip service sets 'clientId', so we can assume outbound if present.
    let instruction = prompts.outbound;
    if (this.context.mode === 'inbound') {
        instruction = prompts.inbound;
    }

    const sessionUpdate = {
      type: 'session.update',
      session: {
        turn_detection: { type: 'server_vad', silence_duration_ms: 1500 },
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        voice: 'coral',
        instructions: instruction,
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Schedule a technical assessment when the user says YES and provides all details.",
            parameters: {
              type: "object",
              properties: {
                name: { type: "string", description: "Name of the contact person" },
                companyName: { type: "string", description: "Name of the company" },
                confirmedPhone: { type: "string", description: "The verified best callback number" },
                time: { type: "string", description: "The agreed time for the assessment" },
                notes: { type: "string", description: "Any additional notes" }
              },
              required: ["name", "companyName", "confirmedPhone", "time"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report the outcome when the user is not interested, asks to call later, or voicemail.",
            parameters: {
              type: "object",
              properties: {
                result: { type: "string", enum: ["NOT_INTERESTED", "CALL_LATER", "VOICEMAIL", "OTHER"], description: "The outcome of the call" },
                details: { type: "string", description: "Summary of what happened" }
              },
              required: ["result"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call politely.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Reason for ending the call" }
              }
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
        await this.handleScheduleAppointment(parsedArgs);
      } else if (name === 'report_interaction') {
        await this.handleReportInteraction(parsedArgs);
      } else if (name === 'end_call') {
        await this.handleEndCall(parsedArgs);
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

      // Trigger a response generation if not ending call
      if (name !== 'end_call') {
          this.sendToOpenAI({ type: 'response.create' });
      }

    } catch (error) {
      logger.error(`Error executing function ${name}:`, error);
    }
  }

  async appendToFile(filePath, data) {
    try {
      let content = [];
      try {
        const fileData = await fs.readFile(filePath, 'utf-8');
        content = JSON.parse(fileData);
      } catch (e) {
        // File might be empty or not exist
      }
      content.push(data);
      await fs.writeFile(filePath, JSON.stringify(content, null, 2));
    } catch (error) {
      logger.error(`Error writing to file ${filePath}:`, error);
    }
  }

  async handleScheduleAppointment(args) {
    const record = {
      ...args,
      callSid: this.callSid,
      timestamp: new Date().toISOString(),
      callerId: this.context.callerId || 'Unknown'
    };
    await this.appendToFile(LEADS_FILE, record);
    await sendReport('SUCCESS', record);
  }

  async handleReportInteraction(args) {
    const record = {
      ...args,
      callSid: this.callSid,
      timestamp: new Date().toISOString(),
      callerId: this.context.callerId || 'Unknown'
    };
    await this.appendToFile(INTERACTIONS_FILE, record);
    await sendReport('REPORT', record);
  }

  async handleEndCall(args) {
    logger.info(`Ending call: ${args.reason}`);
    // Say goodbye (OpenAI might have already generated audio for the farewell before calling this tool,
    // or we might want to let it generate a response after this tool output).
    // The spec says: "Retardo de 10 segundos before closing socket".

    // We initiate the delay.
    setTimeout(() => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.close();
        }
        if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
            this.openaiWs.close();
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
      this.context = data.start.customParameters || {};
      logger.info(`Stream started: ${this.streamSid} with context: ${JSON.stringify(this.context)}`);

      // If we need to re-send session update because we now know the context (inbound/outbound), we could do it here.
      // But sendSessionUpdate was called on 'open' of OpenAI socket.
      // Usually Twilio 'start' comes very quickly.
      // If OpenAI is already connected, we might want to update instructions if they differ.
      // For now, let's assume session update is robust enough or we send it again.
      // Actually, it's better to send session update AFTER we have context if possible,
      // but OpenAI connection might take time.
      // A simple fix: Call sendSessionUpdate again here if context dictates a different prompt.

      this.sendSessionUpdate();

    } else if (data.event === 'media') {
        const audioAppend = {
            type: 'input_audio_buffer.append',
            audio: data.media.payload
        };
        this.sendToOpenAI(audioAppend);
    }
  }
}
