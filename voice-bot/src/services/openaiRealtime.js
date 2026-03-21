import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendNotificationEmail } from './emailService.js';
import twilio from 'twilio';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const leadsFilePath = path.join(__dirname, '../data/leads.json');
const interactionsFilePath = path.join(__dirname, '../data/interactions.json');

// Ensure data files exist
[leadsFilePath, interactionsFilePath].forEach(filePath => {
    if (!fs.existsSync(path.dirname(filePath))) {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
    }
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, JSON.stringify([], null, 2));
    }
});

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
    const systemInstruction = this.mode === 'outbound' ? prompts.SARAH_OUTBOUND : prompts.SARAH_INBOUND;

    const sessionUpdate = {
      type: 'session.update',
      session: {
        turn_detection: {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 1500
        },
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        voice: 'coral', // Updated voice
        instructions: systemInstruction,
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Schedule a Technical Assessment. Trigger ONLY when you have collected the Trifecta (contactName, companyName, confirmedPhone) and appointmentTime.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the IT Manager or Owner" },
                companyName: { type: "string", description: "Name of the company" },
                confirmedPhone: { type: "string", description: "The verbally confirmed phone number to call back" },
                appointmentTime: { type: "string", description: "The requested time for the assessment tomorrow" },
                notes: { type: "string", description: "Any extra context about pain points (Internet, VoIP, IT)" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Log an interaction when the client is not interested, asks to call later, or if you hit voicemail.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Reason for the report (e.g., 'Not interested', 'Call back later', 'Voicemail')" },
                notes: { type: "string", description: "Additional context" }
              },
              required: ["reason"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the conversation politely and hang up the call.",
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

    // Initial greeting after connection
    const greetingText = this.mode === 'outbound' ? "Hi, this is Sarah. Do you handle the tech there, or should I ask for the Office Manager?" : "Thank you for calling 1Wire, this is Sarah. How can I help you today?";
    this.sendToOpenAI({
        type: "response.create",
        response: {
            instructions: `Start the conversation immediately by saying: "${greetingText}"`
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
    const { name, arguments: args } = event;
    const parsedArgs = JSON.parse(args);
    const callId = event.call_id;

    logger.info(`Function call detected: ${name} with args: ${args}`);
    let result = null;

    try {
      if (name === 'schedule_appointment') {
        const leads = JSON.parse(fs.readFileSync(leadsFilePath, 'utf-8'));
        leads.push({ timestamp: new Date().toISOString(), callSid: this.callSid, ...parsedArgs });
        fs.writeFileSync(leadsFilePath, JSON.stringify(leads, null, 2));

        const emailContent = `
Contact Name: ${parsedArgs.contactName}
Company: ${parsedArgs.companyName}
Requested Time: ${parsedArgs.appointmentTime}

Phone Verification:
- Twilio CallerID: ${this.callerId}
- Verbally Confirmed Phone: ${parsedArgs.confirmedPhone}

Notes: ${parsedArgs.notes || 'None'}
        `;
        await sendNotificationEmail('🟢 SUCCESS: Technical Assessment Scheduled', emailContent);

        result = { status: 'success', message: 'Appointment scheduled successfully.' };

      } else if (name === 'report_interaction') {
        const interactions = JSON.parse(fs.readFileSync(interactionsFilePath, 'utf-8'));
        interactions.push({ timestamp: new Date().toISOString(), callSid: this.callSid, phone: this.callerId, ...parsedArgs });
        fs.writeFileSync(interactionsFilePath, JSON.stringify(interactions, null, 2));

        const emailContent = `
Phone: ${this.callerId}
Reason: ${parsedArgs.reason}
Notes: ${parsedArgs.notes || 'None'}
        `;
        await sendNotificationEmail('🟠 REPORT: Interaction Logged', emailContent);

        result = { status: 'success', message: 'Interaction reported.' };

      } else if (name === 'end_call') {
        result = { status: 'ending' };

        // Final goodbye response
        this.sendToOpenAI({
            type: "response.create",
            response: {
                instructions: "Say a short, polite goodbye."
            }
        });

        // 10 second delay before closing socket
        setTimeout(async () => {
             logger.info(`Ending call ${this.callSid} after 10s delay`);
             if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                 this.ws.close();
             }
             if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
                 this.openaiWs.close();
             }

             try {
                const client = twilio(config.twilio.accountSid, config.twilio.authToken);
                await client.calls(this.callSid).update({ status: 'completed' });
             } catch(e) {
                logger.error('Error ending call via Twilio:', e);
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
          // Trigger a response generation
          this.sendToOpenAI({ type: 'response.create' });
      }

    } catch (error) {
      logger.error(`Error executing function ${name}:`, error);
      // Optionally send error back
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
      // We already set this.callSid from start.callSid in callController.js to track correctly
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
