import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendEmailReport } from './emailService.js';

export class OpenAIRealtimeService {
  constructor(ws, callSid, callerId) {
    this.ws = ws;
    this.callSid = callSid;
    this.callerId = callerId;
    this.mode = 'inbound'; // Defaults to inbound (receptionist)
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
        this.isOpenAiConnected = false;
      });

    } catch (error) {
      logger.error('Error connecting to OpenAI:', error);
    }
  }

  checkAndInitializeSession() {
    if (this.isOpenAiConnected && this.isTwilioStarted) {
      this.sendSessionUpdate();

      // Start the conversation immediately with a greeting text based on mode
      const greeting = this.mode === 'outbound'
        ? "Hello! Are you the one handling technology or should I ask for an Office Manager?"
        : "Thank you for calling 1Wire. Are you the one handling technology or should I ask for an Office Manager?";

      this.sendToOpenAI({
        type: 'response.create',
        response: {
            instructions: `Start the conversation immediately. Say exactly: "${greeting}"`
        }
      });
    }
  }

  sendSessionUpdate() {
    const systemPrompt = this.mode === 'outbound' ? prompts.SARAH_OUTBOUND : prompts.SARAH_INBOUND;

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
        instructions: systemPrompt,
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Schedule a Technical Assessment. Trigger ONLY when you have collected the Trifecta: Contact Name, Company Name, Confirmed Phone, and Exact Time.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the IT Manager or Owner" },
                companyName: { type: "string", description: "Name of the company" },
                confirmedPhone: { type: "string", description: "The confirmed best phone number to reach them" },
                appointmentTime: { type: "string", description: "The exact time for the appointment tomorrow" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Log the interaction if the client is not interested, asks to call back later, or if you reach voicemail.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Reason for the report: 'Not Interested', 'Call Back Later', or 'Voicemail'" },
                notes: { type: "string", description: "Brief notes about the interaction" }
              },
              required: ["reason", "notes"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "Ends the conversation politely. Trigger this when the conversation is naturally finished after scheduling or reporting.",
            parameters: {
              type: "object",
              properties: {},
              required: []
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
    const callId = event.call_id;

    logger.info(`Function call detected: ${name} with args: ${args}`);
    let parsedArgs;
    try {
        parsedArgs = JSON.parse(args);
    } catch(err) {
        logger.error(`SyntaxError parsing function args for ${name}`, err);
        return; // Crash protection
    }

    let result = null;

    try {
      if (name === 'schedule_appointment') {
        // Log to leads.json
        const leadsFile = path.resolve('src/data/leads.json');
        let leads = [];
        if (fs.existsSync(leadsFile)) leads = JSON.parse(fs.readFileSync(leadsFile, 'utf8'));
        leads.push({ timestamp: new Date().toISOString(), callSid: this.callSid, ...parsedArgs });
        fs.writeFileSync(leadsFile, JSON.stringify(leads, null, 2));

        // Send Success Email
        await sendEmailReport({
          type: 'SUCCESS',
          callSid: this.callSid,
          callerId: this.callerId,
          data: parsedArgs
        });

        result = { status: 'success' };

      } else if (name === 'report_interaction') {
        // Log to interactions.json
        const interactionsFile = path.resolve('src/data/interactions.json');
        let interactions = [];
        if (fs.existsSync(interactionsFile)) interactions = JSON.parse(fs.readFileSync(interactionsFile, 'utf8'));
        interactions.push({ timestamp: new Date().toISOString(), callSid: this.callSid, ...parsedArgs });
        fs.writeFileSync(interactionsFile, JSON.stringify(interactions, null, 2));

        // Send Report Email
        await sendEmailReport({
          type: 'REPORT',
          callSid: this.callSid,
          callerId: this.callerId,
          data: parsedArgs
        });

        result = { status: 'reported' };

      } else if (name === 'end_call') {
        // Wait 10 seconds before closing socket to allow goodbye
        logger.info('End call triggered. Delaying socket close by 10 seconds.');
        result = { status: 'ending_call' };

        // We trigger response to say a short goodbye before closing the socket
        this.sendToOpenAI({
            type: 'response.create',
            response: {
                instructions: "Say a short, polite goodbye."
            }
        });

        setTimeout(() => {
             if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                 this.ws.close();
             }
             if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
                 this.openaiWs.close();
             }
        }, 10000);
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
        // Trigger a response generation if not ending
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
      this.callSid = data.start.callSid; // Update CallSid from Twilio start event
      this.isTwilioStarted = true;
      logger.info(`Stream started: ${this.streamSid} for call ${this.callSid}`);
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
