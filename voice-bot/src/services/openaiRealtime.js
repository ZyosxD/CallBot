import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';

const ensureDataFiles = () => {
    const dataDir = path.join(process.cwd(), 'src', 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    ['leads.json', 'interactions.json'].forEach(file => {
        const filePath = path.join(dataDir, file);
        if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, JSON.stringify([]));
    });
};

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
    ensureDataFiles();
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
          // Force AI to speak first
          const greeting = this.mode === 'outbound' ? "Hi, is this the business owner or do you handle the IT?" : "Thank you for calling, how can I direct your call?";
          this.sendToOpenAI({
              type: 'conversation.item.create',
              item: {
                  type: 'message',
                  role: 'user',
                  content: [{ type: 'input_text', text: `Start the conversation immediately. Say exactly: "${greeting}"` }]
              }
          });
          this.sendToOpenAI({ type: 'response.create' });
      }
  }

  sendSessionUpdate() {
    const instruction = this.mode === 'outbound' ? prompts.SARAH_OUTBOUND : prompts.SARAH_INBOUND;

    const sessionUpdate = {
      type: 'session.update',
      session: {
        turn_detection: { type: 'server_vad', silence_duration_ms: 1500 },
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        voice: 'coral', // or alloy if coral is unavailable, memory says coral
        instructions: instruction,
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Schedule a Technical Assessment with a human specialist. Use ONLY when you have collected the Trifecta and time.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string" },
                companyName: { type: "string" },
                confirmedPhone: { type: "string" },
                appointmentTime: { type: "string" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Log interaction if client is not interested, asks to callback, or reaches voicemail.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string" },
                notes: { type: "string" }
              },
              required: ["reason", "notes"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the current call.",
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
    const { name, arguments: args, call_id: callId } = event;
    logger.info(`Function call detected: ${name} with args: ${args}`);

    let parsedArgs = {};
    try {
        parsedArgs = JSON.parse(args);
    } catch (err) {
        logger.error('Error parsing function arguments:', err);
    }

    let result = { status: 'success' };

    try {
      if (name === 'schedule_appointment') {
          const leadsFile = path.join(process.cwd(), 'src', 'data', 'leads.json');
          const leads = JSON.parse(fs.readFileSync(leadsFile, 'utf8'));
          leads.push({ ...parsedArgs, originalCallerId: this.callerId, timestamp: new Date().toISOString() });
          fs.writeFileSync(leadsFile, JSON.stringify(leads, null, 2));

          const { sendSuccessEmail } = await import('./emailService.js');
          await sendSuccessEmail(parsedArgs, this.callerId);
          result = { message: "Assessment scheduled successfully." };

      } else if (name === 'report_interaction') {
          const interactionsFile = path.join(process.cwd(), 'src', 'data', 'interactions.json');
          const interactions = JSON.parse(fs.readFileSync(interactionsFile, 'utf8'));
          interactions.push({ ...parsedArgs, callerId: this.callerId, timestamp: new Date().toISOString() });
          fs.writeFileSync(interactionsFile, JSON.stringify(interactions, null, 2));

          const { sendReportEmail } = await import('./emailService.js');
          await sendReportEmail(parsedArgs, this.callerId);
          result = { message: "Interaction reported successfully." };

      } else if (name === 'end_call') {
          // Send response back immediately to prevent hang
          const functionOutput = {
            type: 'conversation.item.create',
            item: {
              type: 'function_call_output',
              call_id: callId,
              output: JSON.stringify({ status: 'ending call' })
            }
          };
          this.sendToOpenAI(functionOutput);

          // Goodbye message
          this.sendToOpenAI({
              type: 'conversation.item.create',
              item: {
                  type: 'message',
                  role: 'user',
                  content: [{ type: 'input_text', text: 'Say a short, polite goodbye.' }]
              }
          });
          this.sendToOpenAI({ type: 'response.create' });

          setTimeout(() => {
              if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                  this.ws.close();
              }
          }, 10000);

          return; // Exit early since we handled the function output manually
      }

      // Send result back to OpenAI for normal tools
      const functionOutput = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify(result)
        }
      };
      this.sendToOpenAI(functionOutput);
      this.sendToOpenAI({ type: 'response.create' });

    } catch (error) {
      logger.error(`Error executing function ${name}:`, error);
      const functionOutput = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify({ status: 'error', error: error.message })
        }
      };
      this.sendToOpenAI(functionOutput);
      this.sendToOpenAI({ type: 'response.create' });
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
