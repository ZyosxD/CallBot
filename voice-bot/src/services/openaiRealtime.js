import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendEmailNotification } from './emailService.js';
import twilio from 'twilio';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

        // Instruct Sarah to speak first
        this.sendToOpenAI({
          type: 'response.create',
          response: {
            instructions: "Start the conversation immediately by enthusiastically saying your greeting. Do not wait for the user to speak."
          }
        });
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
    const systemInstruction = this.mode === 'outbound' ? prompts.SARAH_OUTBOUND : prompts.SARAH_INBOUND;

    const sessionUpdate = {
      type: 'session.update',
      session: {
        turn_detection: {
          type: 'server_vad',
          silence_duration_ms: 1500
        },
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        voice: 'coral', // Using 'coral' as per specifications
        instructions: systemInstruction,
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Schedule a Technical Assessment appointment. Requires contactName, companyName, confirmedPhone, and appointmentTime. MUST be called when user agrees.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the person to speak with (IT Manager/Owner)" },
                companyName: { type: "string", description: "Name of the company" },
                confirmedPhone: { type: "string", description: "Best phone number to call back on" },
                appointmentTime: { type: "string", description: "Exact time and date for the appointment" },
                notes: { type: "string", description: "Any extra notes regarding their current service issues or needs" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report an interaction that did NOT result in an appointment (e.g., user not interested, voicemail, or requested to call back later)",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Reason why appointment wasn't scheduled (e.g., Voicemail, Not Interested, Call Later)" },
                details: { type: "string", description: "Additional details about the conversation" }
              },
              required: ["reason"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the current call and hang up. Use this when the conversation is completely finished.",
            parameters: {
              type: "object",
              properties: {}
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
    let result = null;

    try {
      if (name === 'schedule_appointment') {
        result = await this.handleScheduleAppointment(parsedArgs);
      } else if (name === 'report_interaction') {
        result = await this.handleReportInteraction(parsedArgs);
      } else if (name === 'end_call') {
        result = await this.handleEndCall();
      }

      // Send result back to OpenAI to resolve the function call and prevent hanging
      const functionOutput = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify(result || { success: true })
        }
      };
      this.sendToOpenAI(functionOutput);

      // Trigger a response generation for tools that don't terminate immediately
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
      this.sendToOpenAI({ type: 'response.create' });
    }
  }

  async handleScheduleAppointment(data) {
    const leadsFilePath = path.join(__dirname, '../data/leads.json');

    // Ensure file exists
    if (!fs.existsSync(leadsFilePath)) {
      fs.writeFileSync(leadsFilePath, JSON.stringify([], null, 2));
    }

    const leadsData = fs.readFileSync(leadsFilePath, 'utf8');
    const leads = JSON.parse(leadsData);

    const newLead = {
      ...data,
      originalCallerId: this.callerId,
      timestamp: new Date().toISOString()
    };

    leads.push(newLead);
    fs.writeFileSync(leadsFilePath, JSON.stringify(leads, null, 2), 'utf8');

    logger.info(`Appointment scheduled for ${data.contactName} at ${data.companyName}`);

    // Send Success Email
    await sendEmailNotification(true, newLead);

    return { status: "success", message: "Appointment saved successfully." };
  }

  async handleReportInteraction(data) {
    const interactionsFilePath = path.join(__dirname, '../data/interactions.json');

    // Ensure file exists
    if (!fs.existsSync(interactionsFilePath)) {
      fs.writeFileSync(interactionsFilePath, JSON.stringify([], null, 2));
    }

    const interactionsData = fs.readFileSync(interactionsFilePath, 'utf8');
    const interactions = JSON.parse(interactionsData);

    const newInteraction = {
      ...data,
      originalCallerId: this.callerId,
      timestamp: new Date().toISOString()
    };

    interactions.push(newInteraction);
    fs.writeFileSync(interactionsFilePath, JSON.stringify(interactions, null, 2), 'utf8');

    logger.info(`Interaction reported: ${data.reason}`);

    // Send Report Email
    await sendEmailNotification(false, newInteraction);

    return { status: "success", message: "Interaction reported successfully." };
  }

  async handleEndCall() {
    logger.info(`Initiating end_call sequence for ${this.callSid}...`);

    // Send a final goodbye prompt
    this.sendToOpenAI({
      type: 'response.create',
      response: {
        instructions: "Say a short, polite goodbye."
      }
    });

    // Wait 10 seconds for the goodbye to play before closing
    setTimeout(async () => {
      logger.info(`10s elapsed. Closing websocket for ${this.callSid}`);
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.close();
      }
      if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
          this.openaiWs.close();
      }

      // Attempt to actively hang up via Twilio API if possible
      try {
        const client = twilio(config.twilio.accountSid, config.twilio.authToken);
        await client.calls(this.callSid).update({ status: 'completed' });
      } catch (err) {
        logger.error(`Error explicitly terminating Twilio call ${this.callSid}: ${err.message}`);
      }

    }, 10000);

    return { status: "ending", message: "Call will end in 10 seconds." };
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
      // Need to capture the CallSid specifically here inside handleTwilioMedia to correctly track the session ID per memory
      if (data.start.callSid) {
        this.callSid = data.start.callSid;
      }
      logger.info(`Stream started: ${this.streamSid} for CallSid: ${this.callSid}`);
    } else if (data.event === 'media') {
        const audioAppend = {
            type: 'input_audio_buffer.append',
            audio: data.media.payload
        };
        this.sendToOpenAI(audioAppend);
    }
  }
}
