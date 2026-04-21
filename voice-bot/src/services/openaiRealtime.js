import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import fs from 'fs';
import path from 'path';

export class OpenAIRealtimeService {
  constructor(ws, callSid) {
    this.ws = ws;
    this.callSid = callSid;
    this.openaiWs = null;
    this.streamSid = null;
    this.isOpenAiConnected = false;
    this.isTwilioStarted = false;
    this.mode = 'inbound';
    this.callerId = 'unknown';
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
        this.isOpenAiConnected = false;
      });

    } catch (error) {
      logger.error('Error connecting to OpenAI:', error);
    }
  }

  checkAndInitializeSession() {
    if (this.isOpenAiConnected && this.isTwilioStarted) {
      logger.info('Both OpenAI and Twilio are connected. Initializing session.');
      this.sendSessionUpdate();
      this.sendInitialGreeting();
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
            description: "Schedule a Technical Assessment. Use this ONLY when you have collected all the required details.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "The name of the contact person" },
                companyName: { type: "string", description: "The name of the company" },
                confirmedPhone: { type: "string", description: "The phone number the client confirmed verbally" },
                appointmentTime: { type: "string", description: "The exact date and time for the appointment" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report the interaction if the client is not interested, asks to call back later, or if a voicemail was reached.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "The reason for the report (e.g., Not interested, Call back, Voicemail)" },
                details: { type: "string", description: "Any additional details or notes" }
              },
              required: ["reason"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call. ALWAYS use this tool at the very end of the conversation when you are ready to hang up. Be sure to say goodbye.",
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

  sendInitialGreeting() {
    this.sendToOpenAI({
      type: 'response.create',
      response: {
        instructions: 'Start the conversation immediately. Introduce yourself briefly as Sarah from 1Wire.'
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
    const { name, arguments: args, call_id: callId } = event;
    logger.info(`Function call detected: ${name} with args: ${args}`);

    let parsedArgs = {};
    try {
      parsedArgs = JSON.parse(args);
    } catch (e) {
      logger.error(`Error parsing JSON arguments for function ${name}:`, e);
      // We will still send a failure output
    }

    let result = null;

    try {
      if (name === 'schedule_appointment') {
        result = await this.executeScheduleAppointment(parsedArgs);
      } else if (name === 'report_interaction') {
        result = await this.executeReportInteraction(parsedArgs);
      } else if (name === 'end_call') {
        result = await this.executeEndCall();
      } else {
        result = { error: 'Unknown function' };
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

      if (name !== 'end_call') {
        // Trigger a response generation for normal tools
        this.sendToOpenAI({ type: 'response.create' });
      }

    } catch (error) {
      logger.error(`Error executing function ${name}:`, error);
    }
  }

  async executeScheduleAppointment(data) {
    logger.info(`Scheduling appointment: ${JSON.stringify(data)}`);

    const leadData = {
      ...data,
      twilioCallerId: this.callerId,
      callSid: this.callSid,
      timestamp: new Date().toISOString()
    };

    // Save to leads.json
    try {
      const leadsPath = path.resolve('src/data/leads.json');
      let leads = [];
      if (fs.existsSync(leadsPath)) {
        leads = JSON.parse(fs.readFileSync(leadsPath, 'utf-8'));
      }
      leads.push(leadData);
      fs.writeFileSync(leadsPath, JSON.stringify(leads, null, 2));
    } catch (e) {
      logger.error('Error saving lead to JSON:', e);
    }

    // Send Success Email
    try {
      const { sendEmail } = await import('./emailService.js');
      await sendEmail('SUCCESS', leadData);
    } catch (e) {
      logger.error('Failed to import or send email', e);
    }

    return { status: 'success', message: 'Appointment scheduled successfully.' };
  }

  async executeReportInteraction(data) {
    logger.info(`Reporting interaction: ${JSON.stringify(data)}`);

    const interactionData = {
      ...data,
      twilioCallerId: this.callerId,
      callSid: this.callSid,
      timestamp: new Date().toISOString()
    };

    // Save to interactions.json
    try {
      const intsPath = path.resolve('src/data/interactions.json');
      let interactions = [];
      if (fs.existsSync(intsPath)) {
        interactions = JSON.parse(fs.readFileSync(intsPath, 'utf-8'));
      }
      interactions.push(interactionData);
      fs.writeFileSync(intsPath, JSON.stringify(interactions, null, 2));
    } catch (e) {
      logger.error('Error saving interaction to JSON:', e);
    }

    // Send Report Email
    try {
      const { sendEmail } = await import('./emailService.js');
      await sendEmail('REPORT', interactionData);
    } catch (e) {
      logger.error('Failed to import or send email', e);
    }

    return { status: 'success', message: 'Interaction reported.' };
  }

  async executeEndCall() {
    logger.info(`Executing end_call for ${this.callSid}`);

    // Request the AI to say goodbye politely one last time before we force close
    this.sendToOpenAI({
      type: 'response.create',
      response: {
        instructions: 'Say a very short, polite goodbye.'
      }
    });

    // Wait 10 seconds before forcefully closing
    setTimeout(() => {
      logger.info(`Timeout reached. Closing connections for ${this.callSid}`);
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.close();
      }
      if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
        this.openaiWs.close();
      }
    }, 10000);

    return { status: 'closing_in_10s' };
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
