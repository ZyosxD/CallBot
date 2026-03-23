import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';
import twilio from 'twilio';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class OpenAIRealtimeService {
  constructor(ws, callSid, callerId, mode) {
    this.ws = ws;
    this.callSid = callSid;
    this.callerId = callerId;
    this.mode = mode;
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
            description: "Schedule a technical assessment after collecting all required information.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the person to speak with." },
                companyName: { type: "string", description: "Name of the company." },
                confirmedPhone: { type: "string", description: "The confirmed phone number verbally given by the user." },
                appointmentTime: { type: "string", description: "The exact time for the appointment." },
                needs: { type: "string", description: "Summary of internet, VoIP, or IT needs detected." }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Log an interaction if the user is not interested, asks to call back later, or if it goes to voicemail.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Reason for the report (e.g., 'not interested', 'voicemail', 'call back')." },
                notes: { type: "string", description: "Additional notes about the interaction." }
              },
              required: ["reason"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "Politely end the conversation. Call this after scheduling an appointment, reporting an interaction, or when the user wants to hang up.",
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

    // Initial message to make Sarah speak first
    setTimeout(() => {
      const initialGreeting = this.mode === 'outbound'
        ? "Start the conversation immediately with: Hi, um, this is Sarah from 1Wire. Are you the one who manages the technology there, or should I ask for the Office Manager?"
        : "Start the conversation immediately with: Hi, um, thank you for calling 1Wire. This is Sarah. How can I, you know, help you today?";

      this.sendToOpenAI({
        type: 'response.create',
        response: {
          instructions: initialGreeting
        }
      });
    }, 1000); // Slight delay to ensure session is updated
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
    let result = null;

    try {
      if (name === 'schedule_appointment') {
        result = await this.handleScheduleAppointment(parsedArgs);
      } else if (name === 'report_interaction') {
        result = await this.handleReportInteraction(parsedArgs);
      } else if (name === 'end_call') {
        result = await this.handleEndCall();
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

      if (name === 'end_call') {
          // Tell AI to say a final polite goodbye
          this.sendToOpenAI({
            type: 'response.create',
            response: {
                instructions: 'Say a short, polite goodbye right now before hanging up.'
            }
          });

          // Delayed termination logic is handled inside handleEndCall
      } else {
        // Trigger a normal response generation
        this.sendToOpenAI({ type: 'response.create' });
      }

    } catch (error) {
      logger.error(`Error executing function ${name}:`, error);
    }
  }

  async handleScheduleAppointment(args) {
    logger.info(`Scheduling appointment for ${args.contactName}`);
    const leadData = {
        id: Date.now().toString(),
        callSid: this.callSid,
        callerId: this.callerId,
        contactName: args.contactName,
        companyName: args.companyName,
        confirmedPhone: args.confirmedPhone,
        appointmentTime: args.appointmentTime,
        needs: args.needs || '',
        timestamp: new Date().toISOString()
    };

    const leadsPath = path.join(__dirname, '../data/leads.json');
    let leads = [];
    if (fs.existsSync(leadsPath)) {
        leads = JSON.parse(fs.readFileSync(leadsPath, 'utf8'));
    }
    leads.push(leadData);
    fs.writeFileSync(leadsPath, JSON.stringify(leads, null, 2));

    await sendSuccessEmail(leadData);

    return { status: 'success', message: 'Appointment scheduled. You can now end the call.' };
  }

  async handleReportInteraction(args) {
    logger.info(`Reporting interaction: ${args.reason}`);
    const interactionData = {
        id: Date.now().toString(),
        callSid: this.callSid,
        callerId: this.callerId,
        reason: args.reason,
        notes: args.notes || '',
        timestamp: new Date().toISOString()
    };

    const interactionsPath = path.join(__dirname, '../data/interactions.json');
    let interactions = [];
    if (fs.existsSync(interactionsPath)) {
        interactions = JSON.parse(fs.readFileSync(interactionsPath, 'utf8'));
    }
    interactions.push(interactionData);
    fs.writeFileSync(interactionsPath, JSON.stringify(interactions, null, 2));

    await sendReportEmail(interactionData);

    return { status: 'success', message: 'Interaction reported. You can now end the call.' };
  }

  async handleEndCall() {
      logger.info(`End call initiated. Closing socket in 10 seconds.`);

      setTimeout(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
              logger.info('Closing Twilio WebSocket');
              this.ws.close();
          }
          if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
              logger.info('Closing OpenAI WebSocket');
              this.openaiWs.close();
          }
      }, 10000);

      return { status: 'ending', message: 'The call will end in 10 seconds. Say goodbye now.' };
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
      // Note: this.callSid is updated by callController if passed in custom params,
      // but if the fallback logic in callController is used, we ensure it here too.
      this.callSid = data.start.callSid;
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
