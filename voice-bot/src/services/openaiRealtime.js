import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import twilio from 'twilio';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sendEmail } from './emailService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const leadsFilePath = path.join(__dirname, '../data/leads.json');
const interactionsFilePath = path.join(__dirname, '../data/interactions.json');

export class OpenAIRealtimeService {
  constructor(ws, callSid, callerId, mode) {
    this.ws = ws;
    this.callSid = callSid;
    this.callerId = callerId;
    this.mode = mode;
    this.openaiWs = null;
    this.streamSid = null;
    this.greetingSent = false;
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
            description: "Schedule a Technical Assessment after collecting The Trifecta (Contact Name, Company Name, Verified Phone, Exact Time).",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the person to speak with." },
                companyName: { type: "string", description: "Name of the company." },
                confirmedPhone: { type: "string", description: "The verbally confirmed phone number." },
                appointmentTime: { type: "string", description: "Exact time and day for the call." },
                notes: { type: "string", description: "Any extra details (pain points, current setup)." }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report the result of a call when an assessment is not scheduled (e.g., not interested, voicemail, call back later).",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Why the call didn't result in an appointment (e.g. 'Voicemail', 'Not interested')." },
                contactName: { type: "string", description: "Name if obtained, otherwise unknown." },
                notes: { type: "string", description: "Summary of what happened." }
              },
              required: ["reason", "notes"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "Politely end the conversation. Call this after saying goodbye.",
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

        // Ensure the bot speaks first
        if (!this.greetingSent) {
          this.greetingSent = true;
          this.sendToOpenAI({
            type: 'response.create',
            response: {
              instructions: 'Start the conversation immediately by greeting the user politely according to your persona rules.'
            }
          });
        }
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
        await this.handleEndCall();
        result = { status: 'ending_call' };
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

      // Trigger a response generation for confirmation if it wasn't end_call
      if (name !== 'end_call') {
          this.sendToOpenAI({ type: 'response.create' });
      }

    } catch (error) {
      logger.error(`Error executing function ${name}:`, error);
    }
  }

  async handleScheduleAppointment(args) {
    try {
      // Read leads
      let leads = [];
      if (fs.existsSync(leadsFilePath)) {
        leads = JSON.parse(fs.readFileSync(leadsFilePath, 'utf8'));
      }

      const newLead = {
        id: Date.now(),
        callerId: this.callerId,
        mode: this.mode,
        ...args,
        timestamp: new Date().toISOString()
      };

      leads.push(newLead);
      fs.writeFileSync(leadsFilePath, JSON.stringify(leads, null, 2), 'utf8');
      logger.info('Lead scheduled successfully:', newLead);

      // Send Success Email
      const emailBody = `
        New Technical Assessment Scheduled!

        Details:
        Contact: ${args.contactName}
        Company: ${args.companyName}
        Time: ${args.appointmentTime}

        Phone Verification:
        Original Caller ID: ${this.callerId}
        Confirmed Phone: ${args.confirmedPhone}

        Notes: ${args.notes || 'None'}
      `;

      await sendEmail('🟢 SUCCESS: Technical Assessment Scheduled', emailBody);

      return { status: "success", message: "Appointment saved successfully." };
    } catch (error) {
      logger.error('Error in schedule_appointment:', error);
      return { status: "error", message: "Failed to save appointment." };
    }
  }

  async handleReportInteraction(args) {
    try {
      // Read interactions
      let interactions = [];
      if (fs.existsSync(interactionsFilePath)) {
        interactions = JSON.parse(fs.readFileSync(interactionsFilePath, 'utf8'));
      }

      const newInteraction = {
        id: Date.now(),
        callerId: this.callerId,
        mode: this.mode,
        ...args,
        timestamp: new Date().toISOString()
      };

      interactions.push(newInteraction);
      fs.writeFileSync(interactionsFilePath, JSON.stringify(interactions, null, 2), 'utf8');
      logger.info('Interaction reported:', newInteraction);

      // Send Report Email
      const emailBody = `
        Call Interaction Report

        Original Caller ID: ${this.callerId}
        Direction: ${this.mode}

        Reason: ${args.reason}
        Contact: ${args.contactName || 'Unknown'}
        Notes: ${args.notes}
      `;

      await sendEmail(`🟠 REPORT: Call Interaction - ${args.reason}`, emailBody);

      return { status: "success", message: "Report saved successfully." };
    } catch (error) {
      logger.error('Error in report_interaction:', error);
      return { status: "error", message: "Failed to save report." };
    }
  }

  async handleEndCall() {
    try {
        logger.info(`Initiating end call sequence for ${this.callSid}`);

        // Instruct OpenAI to say a final goodbye immediately
        this.sendToOpenAI({
            type: 'response.create',
            response: {
                instructions: 'Say a very short, polite goodbye right now.'
            }
        });

        // Wait 10 seconds to allow the final audio to stream and play
        setTimeout(() => {
           logger.info(`Closing websocket for call ${this.callSid} after 10s delay`);
           if (this.ws && this.ws.readyState === WebSocket.OPEN) {
               this.ws.close();
           }
        }, 10000);

    } catch (error) {
        logger.error('Error handling end call:', error);
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
      this.callSid = data.start.callSid; // explicitly update from start event
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
