import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger from '../utils/logger.js';
import fs from 'fs';
import path from 'path';

// Helper for file paths
const dataDir = path.resolve('src/data');
const leadsFile = path.join(dataDir, 'leads.json');
const interactionsFile = path.join(dataDir, 'interactions.json');

export class OpenAIRealtimeService {
  constructor(ws, callSid) {
    this.ws = ws;
    this.callSid = callSid;
    this.callerId = 'unknown';
    this.mode = 'inbound';

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

  handleTwilioStart() {
    this.isTwilioStarted = true;
    this.checkAndInitializeSession();
  }

  checkAndInitializeSession() {
    if (this.isOpenAiConnected && this.isTwilioStarted) {
      this.sendSessionUpdate();
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
            description: "Schedule a Technical Assessment after receiving the Contact Name, Company Name, Verified Phone Number, and Appointment Time.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the IT Manager or Owner" },
                companyName: { type: "string", description: "Name of the company" },
                confirmedPhone: { type: "string", description: "Verbally confirmed phone number" },
                appointmentTime: { type: "string", description: "Exact date and time for the appointment" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report the call outcome when the client is not interested, asks to call back later, or reaches voicemail.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Reason for interaction outcome (e.g. voicemail, not interested, call back later)" },
                details: { type: "string", description: "Any additional details" }
              },
              required: ["reason"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the conversation gracefully. Use this at the very end of the call after all pitches or scheduling is done.",
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

    let parsedArgs = {};
    try {
      if (args && args.trim() !== '') {
        parsedArgs = JSON.parse(args);
      }
    } catch (err) {
      logger.error(`Error parsing JSON for tool ${name}:`, err);
    }

    let result = null;

    try {
      if (name === 'schedule_appointment') {
        result = await this.executeScheduleAppointment(parsedArgs);
      } else if (name === 'report_interaction') {
        result = await this.executeReportInteraction(parsedArgs);
      } else if (name === 'end_call') {
        result = { status: 'ending' };

        // Return output immediately
        this.sendToOpenAI({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: callId,
            output: JSON.stringify(result)
          }
        });

        // Trigger goodbye response
        this.sendToOpenAI({ type: 'response.create' });

        // Delay 10s then close websocket
        setTimeout(() => {
          logger.info(`Closing WebSocket for call ${this.callSid} after end_call delay`);
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.close();
          }
        }, 10000);
        return; // Return early, handled above
      }

      // Send result back to OpenAI for other tools
      const functionOutput = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify(result)
        }
      };
      this.sendToOpenAI(functionOutput);

      // Trigger response generation
      this.sendToOpenAI({ type: 'response.create' });

    } catch (error) {
      logger.error(`Error executing function ${name}:`, error);

      const functionOutput = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify({ error: error.message })
        }
      };
      this.sendToOpenAI(functionOutput);
      this.sendToOpenAI({ type: 'response.create' });
    }
  }

  async executeScheduleAppointment(data) {
    const newLead = {
      ...data,
      originalCallerId: this.callerId,
      callSid: this.callSid,
      timestamp: new Date().toISOString()
    };

    // Append to leads.json
    try {
      let leads = [];
      if (fs.existsSync(leadsFile)) {
        leads = JSON.parse(fs.readFileSync(leadsFile, 'utf8'));
      }
      leads.push(newLead);
      fs.writeFileSync(leadsFile, JSON.stringify(leads, null, 2));
    } catch (err) {
      logger.error('Error saving lead:', err);
    }

    // Send Success Email
    try {
      const { sendSuccessEmail } = await import('./emailService.js');
      await sendSuccessEmail(newLead);
    } catch (err) {
      logger.error('Error sending success email:', err);
    }

    return { success: true, message: "Appointment scheduled successfully." };
  }

  async executeReportInteraction(data) {
    const interaction = {
      ...data,
      callerId: this.callerId,
      callSid: this.callSid,
      timestamp: new Date().toISOString()
    };

    // Append to interactions.json
    try {
      let interactions = [];
      if (fs.existsSync(interactionsFile)) {
        interactions = JSON.parse(fs.readFileSync(interactionsFile, 'utf8'));
      }
      interactions.push(interaction);
      fs.writeFileSync(interactionsFile, JSON.stringify(interactions, null, 2));
    } catch (err) {
      logger.error('Error saving interaction:', err);
    }

    // Send Report Email
    try {
      const { sendReportEmail } = await import('./emailService.js');
      await sendReportEmail(interaction);
    } catch (err) {
      logger.error('Error sending report email:', err);
    }

    return { success: true, message: "Interaction reported." };
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
