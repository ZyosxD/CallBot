import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';
import dayjs from 'dayjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const leadsFilePath = path.join(__dirname, '../data/leads.json');
const interactionsFilePath = path.join(__dirname, '../data/interactions.json');

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
        this.isOpenAiConnected = false;
      });

    } catch (error) {
      logger.error('Error connecting to OpenAI:', error);
    }
  }

  checkAndInitializeSession() {
    if (this.isOpenAiConnected && this.isTwilioStarted) {
       this.sendSessionUpdate();

       // Start conversation immediately
       let greeting = "Hello, how can I help you with your technology needs today?";
       if (this.mode === 'outbound') {
         greeting = "Hi, are you the person who handles technology, or should I ask for the Office Manager?";
       }

       this.sendToOpenAI({
         type: 'conversation.item.create',
         item: {
           type: 'message',
           role: 'user',
           content: [
             {
               type: 'input_text',
               text: "Start the conversation immediately. Say exactly: " + greeting
             }
           ]
         }
       });
       this.sendToOpenAI({ type: 'response.create' });
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
            description: "Schedule a Technical Assessment after receiving The Trifecta (Contact Name, Company Name, Confirmed Phone) and Exact Time.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Who should we ask for?" },
                companyName: { type: "string", description: "Mandatory to check the fiber map" },
                confirmedPhone: { type: "string", description: "The best phone number to call" },
                appointmentTime: { type: "string", description: "Exact time for the assessment" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report the interaction if the client is not interested, asks to call back later, or it's a voicemail.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "The reason the assessment wasn't scheduled" }
              },
              required: ["reason"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call and say goodbye to the user.",
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

    logger.info(`Function call detected: ${name} with args: ${args}`);

    let parsedArgs = {};
    try {
        parsedArgs = JSON.parse(args);
    } catch (e) {
        logger.error(`Failed to parse JSON args for ${name}`, e);
        return;
    }

    let result = null;

    try {
      if (name === 'schedule_appointment') {
        // Save to leads.json
        const leadData = {
           id: Date.now(),
           ...parsedArgs,
           callerId: this.callerId,
           timestamp: dayjs().toISOString()
        };

        const leads = fs.existsSync(leadsFilePath) ? JSON.parse(fs.readFileSync(leadsFilePath)) : [];
        leads.push(leadData);
        fs.writeFileSync(leadsFilePath, JSON.stringify(leads, null, 2));

        // Send Email
        await sendSuccessEmail(parsedArgs.contactName, parsedArgs.companyName, parsedArgs.confirmedPhone, this.callerId, parsedArgs.appointmentTime);

        result = { success: true, message: 'Assessment scheduled successfully.' };

      } else if (name === 'report_interaction') {
        // Save to interactions.json
        const interactionData = {
           id: Date.now(),
           reason: parsedArgs.reason,
           callerId: this.callerId,
           timestamp: dayjs().toISOString()
        };

        const interactions = fs.existsSync(interactionsFilePath) ? JSON.parse(fs.readFileSync(interactionsFilePath)) : [];
        interactions.push(interactionData);
        fs.writeFileSync(interactionsFilePath, JSON.stringify(interactions, null, 2));

        // Send Email
        await sendReportEmail(parsedArgs.reason, this.callerId);

        result = { success: true, message: 'Interaction reported.' };

      } else if (name === 'end_call') {
        logger.info(`Ending call for ${this.callSid} in 10 seconds`);

        // Return tool output immediately to avoid model hang
        this.sendToOpenAI({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: callId,
            output: JSON.stringify({ success: true, message: "Call ending in 10s. Say goodbye politely." })
          }
        });

        // Trigger a final response to say goodbye
        this.sendToOpenAI({ type: 'response.create' });

        // Wait 10 seconds before forcefully closing
        setTimeout(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.close();
            }
            if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
                this.openaiWs.close();
            }
        }, 10000);

        return; // Prevent standard output handling
      }

      // Send result back to OpenAI for other tools
      if (name !== 'end_call') {
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
      this.callSid = data.start.callSid; // explicitly track
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
