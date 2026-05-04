import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import twilio from 'twilio';

// We dynamically import emailService to avoid early require issues if not fully loaded
let emailService;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const leadsFile = path.join(__dirname, '../data/leads.json');
const interactionsFile = path.join(__dirname, '../data/interactions.json');

const writeJsonFile = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));
const readJsonFile = (file) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : [];

export class OpenAIRealtimeService {
  constructor(ws, callSid) {
    this.ws = ws;
    this.callSid = callSid;
    this.openaiWs = null;
    this.streamSid = null;
    this.callerId = 'unknown';
    this.mode = 'inbound';

    // Connection race condition flags
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
          logger.info('Both OpenAI and Twilio are ready. Initializing session...');
          this.sendSessionUpdate();
      }
  }

  sendSessionUpdate() {
    const instructions = this.mode === 'outbound' ? prompts.SARAH_OUTBOUND : prompts.SARAH_INBOUND;

    const sessionUpdate = {
      type: 'session.update',
      session: {
        turn_detection: { type: 'server_vad', silence_duration_ms: 1500 },
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        voice: 'coral',
        instructions: instructions,
        modalities: ["text", "audio"],
        temperature: 0.7,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Triggers when the client agrees to a Technical Assessment. MUST strictly collect the Trifecta (Contact Name, Company Name, Confirmed Phone) and Exact Appointment Time before calling.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "The name of the contact person." },
                companyName: { type: "string", description: "The name of the company." },
                confirmedPhone: { type: "string", description: "The verbally confirmed phone number to reach them." },
                appointmentTime: { type: "string", description: "The agreed upon time and date for the Technical Assessment." }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Triggers when a client is not interested, asks to call back later, or reaches a voicemail. Saves interaction details.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Reason for the report (e.g., Not Interested, Call Later, Voicemail)." },
                summary: { type: "string", description: "A brief summary of what happened." }
              },
              required: ["reason", "summary"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "Ends the active phone call. Use this only after scheduling an appointment, completing a report, or naturally ending the conversation.",
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
    const callId = event.call_id;
    let parsedArgs = {};

    logger.info(`Function call detected: ${name} with args: ${args}`);

    try {
        parsedArgs = JSON.parse(args);
    } catch (e) {
        logger.error(`SyntaxError parsing JSON arguments for tool ${name}`, e);
        return; // Prevent crash, ignore hallucinatory tool call
    }

    let result = null;

    try {
      if (!emailService) {
          emailService = await import('./emailService.js');
      }

      if (name === 'schedule_appointment') {
        const leads = readJsonFile(leadsFile);
        leads.push({ ...parsedArgs, callerId: this.callerId, callSid: this.callSid, timestamp: new Date().toISOString() });
        writeJsonFile(leadsFile, leads);

        result = { status: "SUCCESS" };
        logger.info("Saved new Lead.");

        if (emailService.sendEmail) {
            emailService.sendEmail('🟢 SUCCESS - Technical Assessment Scheduled', `
                <h2>New Appointment!</h2>
                <p><strong>Contact Name:</strong> ${parsedArgs.contactName}</p>
                <p><strong>Company:</strong> ${parsedArgs.companyName}</p>
                <p><strong>Confirmed Phone:</strong> ${parsedArgs.confirmedPhone}</p>
                <p><strong>Twilio Caller ID:</strong> ${this.callerId}</p>
                <p><strong>Time:</strong> ${parsedArgs.appointmentTime}</p>
            `);
        }

      } else if (name === 'report_interaction') {
        const interactions = readJsonFile(interactionsFile);
        interactions.push({ ...parsedArgs, callerId: this.callerId, callSid: this.callSid, timestamp: new Date().toISOString() });
        writeJsonFile(interactionsFile, interactions);

        result = { status: "SAVED" };
        logger.info("Saved new Interaction Report.");

        if (emailService.sendEmail) {
            emailService.sendEmail('🟠 REPORT - Interaction Logged', `
                <h2>Interaction Report</h2>
                <p><strong>Reason:</strong> ${parsedArgs.reason}</p>
                <p><strong>Summary:</strong> ${parsedArgs.summary}</p>
                <p><strong>Twilio Caller ID:</strong> ${this.callerId}</p>
            `);
        }

      } else if (name === 'end_call') {
        result = { status: "closing_socket" };

        // Fulfill the tool requirement first so it doesn't hang
        this.sendToOpenAI({
            type: 'conversation.item.create',
            item: {
                type: 'function_call_output',
                call_id: callId,
                output: JSON.stringify(result)
            }
        });

        // Trigger a final response to say goodbye
        this.sendToOpenAI({ type: 'response.create' });

        // Delay closing sockets for 10 seconds
        logger.info(`Ending call. Timeout 10s started for CallSid: ${this.callSid}`);
        setTimeout(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.close();
            }
            if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
                this.openaiWs.close();
            }
            logger.info(`Sockets closed after timeout for CallSid: ${this.callSid}`);
        }, 10000);

        return; // Early return to prevent double function output
      }

      // Send result back to OpenAI for regular tools
      const functionOutput = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify(result)
        }
      };
      this.sendToOpenAI(functionOutput);

      // Trigger a response generation
      this.sendToOpenAI({ type: 'response.create' });

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
      this.isTwilioStarted = true;
      logger.info(`Stream started: ${this.streamSid}`);
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
