import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendEmail } from './emailService.js';
import { updateJsonFile } from '../utils/fileLock.js';

const LEADS_FILE = 'src/data/leads.json';
const INTERACTIONS_FILE = 'src/data/interactions.json';

export class OpenAIRealtimeService {
  constructor(ws, callSid, callerId = 'Unknown') {
    this.ws = ws;
    this.callSid = callSid;
    this.callerId = callerId;
    this.openaiWs = null;
    this.streamSid = null;
    this.mode = 'outbound'; // Default to outbound if not specified
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
        // Wait for start event from Twilio to know the mode, or send default update.
        // Actually, we usually get the start event very quickly.
        // But if we send session update immediately, we might not have the mode.
        // However, we can update the session again when we get the start event.
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
    const instructions = this.mode === 'inbound' ? prompts.inbound : prompts.outbound;
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
            description: "Schedule a technical assessment after collecting all required details.",
            parameters: {
              type: "object",
              properties: {
                name: { type: "string", description: "Contact Name" },
                company: { type: "string", description: "Company Name" },
                phone: { type: "string", description: "Verified Phone Number" },
                time: { type: "string", description: "Exact time for the appointment" },
                notes: { type: "string", description: "Any additional notes" }
              },
              required: ["name", "company", "phone", "time"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report an interaction outcome (not interested, callback, voicemail).",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Reason for report (e.g., Not Interested, Callback Later, Voicemail)" },
                summary: { type: "string", description: "Summary of the conversation" }
              },
              required: ["reason"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call.",
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
          callerId: this.callerId,
          timestamp: new Date().toISOString()
        };

        // Save to leads.json
        await updateJsonFile(LEADS_FILE, (data) => {
          data.push(lead);
          return data;
        });

        // Send Success Email
        await sendEmail('success', lead);

        result = { message: "Appointment scheduled and email sent." };

      } else if (name === 'report_interaction') {
        const report = {
          ...parsedArgs,
          callerId: this.callerId,
          timestamp: new Date().toISOString()
        };

        // Save to interactions.json
        await updateJsonFile(INTERACTIONS_FILE, (data) => {
          data.push(report);
          return data;
        });

        // Send Report Email
        await sendEmail('report', report);

        result = { message: "Interaction reported." };

      } else if (name === 'end_call') {
        logger.info('End call requested.');
        // Wait 10 seconds before closing
        setTimeout(() => {
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

      // Trigger a response generation if not ending call immediately
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
      // Extract callerId and mode from custom parameters if available
      if (data.start.customParameters) {
        if (data.start.customParameters.callerId) {
          this.callerId = data.start.customParameters.callerId;
        }
        if (data.start.customParameters.mode) {
          this.mode = data.start.customParameters.mode;
          // Re-send session update with new instructions if mode changed from default
          logger.info(`Mode set to: ${this.mode}. Updating session.`);
          this.sendSessionUpdate();
        }
      }
      logger.info(`Stream started: ${this.streamSid}, CallerID: ${this.callerId}, Mode: ${this.mode}`);
    } else if (data.event === 'media') {
        const audioAppend = {
            type: 'input_audio_buffer.append',
            audio: data.media.payload
        };
        this.sendToOpenAI(audioAppend);
    }
  }
}
