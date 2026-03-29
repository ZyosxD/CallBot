import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import fs from 'fs';
import path from 'path';

export class OpenAIRealtimeService {
  constructor(ws, callSid, callerId, mode) {
    this.ws = ws;
    this.callSid = callSid;
    this.callerId = callerId;
    this.mode = mode; // 'inbound' or 'outbound'
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
    const instructions = this.mode === 'outbound' ? prompts.SARAH_OUTBOUND : prompts.SARAH_INBOUND;
    const greeting = this.mode === 'outbound' ? prompts.greetingOutbound : prompts.greetingInbound;

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
            description: "Schedule a technical assessment after collecting the Trifecta: Contact Name, Company Name, Phone, and Exact Time.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Who should we ask for?" },
                companyName: { type: "string", description: "Mandatory company name" },
                confirmedPhone: { type: "string", description: "Best phone number to call" },
                appointmentTime: { type: "string", description: "Exact time and day (e.g., Tomorrow at 10 AM)" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Log interaction if the client is not interested, asks to call later, or if it reaches voicemail.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Reason: Not Interested, Call Later, Voicemail" },
                notes: { type: "string", description: "Any extra details" }
              },
              required: ["reason"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call gracefully after finishing the conversation.",
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

    // Send the initial greeting
    this.sendToOpenAI({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: greeting }]
      }
    });

    this.sendToOpenAI({ type: 'response.create' });
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
    const callId = event.call_id;
    let parsedArgs = {};

    try {
      parsedArgs = JSON.parse(args);
    } catch (e) {
      logger.error(`SyntaxError parsing JSON arguments for ${name}: ${args}`);
      const functionOutput = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify({ error: "Invalid JSON arguments" })
        }
      };
      this.sendToOpenAI(functionOutput);
      return;
    }

    logger.info(`Function call detected: ${name} with args: ${args}`);
    let result = null;

    try {
      if (name === 'schedule_appointment') {
        result = await this.saveLead(parsedArgs);
      } else if (name === 'report_interaction') {
        result = await this.saveInteraction(parsedArgs);
      } else if (name === 'end_call') {
        result = { status: "Ending call in 10 seconds. Say goodbye." };
        this.handleEndCall();
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

      // Trigger a response generation if it's not ending the call
      if (name !== 'end_call') {
         this.sendToOpenAI({ type: 'response.create' });
      }

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
    }
  }

  async saveLead(data) {
      const leadsFile = path.resolve(process.cwd(), 'src/data/leads.json');
      const payload = {
          callSid: this.callSid,
          callerId: this.callerId,
          ...data,
          timestamp: new Date().toISOString()
      };

      let leads = [];
      try {
          if (fs.existsSync(leadsFile)) {
              leads = JSON.parse(fs.readFileSync(leadsFile, 'utf-8'));
          }
          leads.push(payload);
          fs.writeFileSync(leadsFile, JSON.stringify(leads, null, 2));
      } catch(e) {
          logger.error('Error saving lead:', e);
      }

      try {
          const { sendSuccessEmail } = await import('./emailService.js');
          await sendSuccessEmail(payload, this.callerId);
      } catch (e) {
          logger.error('Error sending success email:', e);
      }

      return { status: "Appointment scheduled and lead saved successfully. You may proceed to close the call." };
  }

  async saveInteraction(data) {
      const interactionsFile = path.resolve(process.cwd(), 'src/data/interactions.json');
      const payload = {
          callSid: this.callSid,
          callerId: this.callerId,
          ...data,
          timestamp: new Date().toISOString()
      };

      let interactions = [];
      try {
          if (fs.existsSync(interactionsFile)) {
              interactions = JSON.parse(fs.readFileSync(interactionsFile, 'utf-8'));
          }
          interactions.push(payload);
          fs.writeFileSync(interactionsFile, JSON.stringify(interactions, null, 2));
      } catch (e) {
          logger.error('Error saving interaction:', e);
      }

      try {
          const { sendReportEmail } = await import('./emailService.js');
          await sendReportEmail(payload, this.callerId);
      } catch (e) {
          logger.error('Error sending report email:', e);
      }

      return { status: "Interaction reported. You may proceed to close the call." };
  }

  handleEndCall() {
    logger.info(`Initiating end call sequence for ${this.callSid}`);

    // Provide one final short message
    this.sendToOpenAI({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: prompts.goodbye }]
      }
    });
    this.sendToOpenAI({ type: 'response.create' });

    setTimeout(() => {
        logger.info(`Closing websockets for call ${this.callSid} after 10 seconds delay.`);
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
      // Note: We correctly track the callSid which was passed into the constructor initially.
      // But if Twilio provides a different one here, update it:
      if (data.start.callSid) {
         this.callSid = data.start.callSid;
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
