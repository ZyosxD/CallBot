import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger from '../utils/logger.js';
import fs from 'fs';
import path from 'path';

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
            description: "Schedule a Technical Assessment. Trigger ONLY when you have collected all 4: Contact Name, Company Name, Confirmed Phone, and Exact Time (The Trifecta).",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the person" },
                companyName: { type: "string", description: "Name of the company" },
                confirmedPhone: { type: "string", description: "The confirmed best phone number to reach them" },
                appointmentTime: { type: "string", description: "Exact time for the appointment" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Log the interaction when a client is not interested, asks to call back later, or if you reach a voicemail.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Reason for reporting (e.g., 'Not interested', 'Call back later', 'Voicemail')" },
                notes: { type: "string", description: "Any additional details or context" }
              },
              required: ["reason"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call and disconnect. Say a short polite goodbye before triggering this.",
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
      if (args) {
         parsedArgs = JSON.parse(args);
      }
    } catch (e) {
      logger.error(`SyntaxError parsing arguments for ${name}:`, e);
      // Fallback
      parsedArgs = {};
    }

    let result = null;

    try {
      if (name === 'schedule_appointment') {
        result = await this.scheduleAppointment(parsedArgs);
      } else if (name === 'report_interaction') {
        result = await this.reportInteraction(parsedArgs);
      } else if (name === 'end_call') {
        result = await this.endCall();
      }

      // Send result back to OpenAI
      const functionOutput = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify(result || { status: 'success' })
        }
      };
      this.sendToOpenAI(functionOutput);

      if (name !== 'end_call') {
         // Trigger a response generation
         this.sendToOpenAI({ type: 'response.create' });
      }

    } catch (error) {
      logger.error(`Error executing function ${name}:`, error);
      const errorOutput = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify({ error: error.message })
        }
      };
      this.sendToOpenAI(errorOutput);
    }
  }

  async scheduleAppointment(args) {
      logger.info('Scheduling appointment:', args);
      const leadData = {
          ...args,
          twilioCallerId: this.callerId,
          callSid: this.callSid,
          timestamp: new Date().toISOString()
      };

      const leadsFile = path.resolve(process.cwd(), 'src/data/leads.json');
      let leads = [];
      try {
          if (fs.existsSync(leadsFile)) {
             leads = JSON.parse(fs.readFileSync(leadsFile, 'utf8'));
          }
      } catch (e) {
          logger.error('Error reading leads.json:', e);
      }
      leads.push(leadData);
      fs.writeFileSync(leadsFile, JSON.stringify(leads, null, 2));

      // Import email service dynamically
      try {
          const { sendReportEmail } = await import('./emailService.js');
          await sendReportEmail('SUCCESS', leadData);
      } catch (e) {
          logger.error('Failed to send success email:', e);
      }

      return { status: 'Appointment scheduled successfully. Tell the user goodbye and end the call.' };
  }

  async reportInteraction(args) {
      logger.info('Reporting interaction:', args);
      const interactionData = {
          ...args,
          twilioCallerId: this.callerId,
          callSid: this.callSid,
          timestamp: new Date().toISOString()
      };

      const interactionsFile = path.resolve(process.cwd(), 'src/data/interactions.json');
      let interactions = [];
      try {
          if (fs.existsSync(interactionsFile)) {
             interactions = JSON.parse(fs.readFileSync(interactionsFile, 'utf8'));
          }
      } catch (e) {
          logger.error('Error reading interactions.json:', e);
      }
      interactions.push(interactionData);
      fs.writeFileSync(interactionsFile, JSON.stringify(interactions, null, 2));

      // Import email service dynamically
      try {
          const { sendReportEmail } = await import('./emailService.js');
          await sendReportEmail('REPORT', interactionData);
      } catch (e) {
          logger.error('Failed to send report email:', e);
      }

      return { status: 'Interaction reported. End the call.' };
  }

  async endCall() {
      logger.info('Ending call in 10 seconds...');

      // Tell the AI to say goodbye right before starting the timeout
      this.sendToOpenAI({ type: 'response.create' });

      setTimeout(async () => {
          logger.info(`Force closing sockets for ${this.callSid}`);
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
              this.ws.close();
          }
          if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
              this.openaiWs.close();
          }

          try {
             const { markCallEnded } = await import('./dripService.js');
             markCallEnded(this.callSid);
          } catch(e) {
             logger.error('Failed to release drip lock:', e);
          }
      }, 10000);

      return { status: 'Closing connection' };
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
      this.isTwilioStarted = true;
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
