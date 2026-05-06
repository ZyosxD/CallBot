import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import fs from 'fs/promises';
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
      });

    } catch (error) {
      logger.error('Error connecting to OpenAI:', error);
    }
  }

  checkAndInitializeSession() {
      if (this.isOpenAiConnected && this.isTwilioStarted) {
          this.sendSessionUpdate();
      }
  }

  sendSessionUpdate() {
    const sessionUpdate = {
      type: 'session.update',
      session: {
        turn_detection: { type: 'server_vad', silence_duration_ms: 1500 },
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        voice: 'coral',
        instructions: prompts.systemInstruction,
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Schedule an appointment after collecting contact name, company name, phone, and time.",
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
            description: "Report the outcome of the call when the client is not interested, asks to call later, or reaches a voicemail.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Reason for the report (e.g. voicemail, not interested, call later)" }
              },
              required: ["reason"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call conversation gracefully after completing the objective or interaction.",
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

    // Kick off conversation if we are the caller
    if (this.mode === 'outbound') {
        setTimeout(() => {
             this.sendToOpenAI({
                 type: 'conversation.item.create',
                 item: {
                     type: 'message',
                     role: 'system',
                     content: [{ type: 'input_text', text: 'The call is connected. Greet the client and ask your first question.' }]
                 }
             });
             this.sendToOpenAI({ type: 'response.create' });
        }, 1000);
    }
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
    let result = null;
    let parsedArgs = {};

    try {
        parsedArgs = JSON.parse(args);
    } catch (e) {
        logger.error(`Failed to parse args for ${name}`, e);
        // Continue but with empty args to avoid crashing
    }

    try {
      if (name === 'schedule_appointment') {
        const lead = {
            id: Date.now().toString(),
            callSid: this.callSid,
            callerId: this.callerId,
            contactName: parsedArgs.contactName,
            companyName: parsedArgs.companyName,
            confirmedPhone: parsedArgs.confirmedPhone,
            appointmentTime: parsedArgs.appointmentTime,
            timestamp: new Date().toISOString()
        };
        const leadsPath = path.resolve('src/data/leads.json');
        const leadsData = JSON.parse(await fs.readFile(leadsPath, 'utf8'));
        leadsData.push(lead);
        await fs.writeFile(leadsPath, JSON.stringify(leadsData, null, 2));

        try {
           const { sendSuccessEmail } = await import('./emailService.js');
           await sendSuccessEmail(lead);
        } catch (emailErr) {
            logger.error('Failed to send success email', emailErr);
        }

        result = { status: 'appointment scheduled successfully' };
      } else if (name === 'report_interaction') {
        const interaction = {
            id: Date.now().toString(),
            callSid: this.callSid,
            callerId: this.callerId,
            reason: parsedArgs.reason,
            timestamp: new Date().toISOString()
        };
        const intPath = path.resolve('src/data/interactions.json');
        const intData = JSON.parse(await fs.readFile(intPath, 'utf8'));
        intData.push(interaction);
        await fs.writeFile(intPath, JSON.stringify(intData, null, 2));

        try {
           const { sendReportEmail } = await import('./emailService.js');
           await sendReportEmail(interaction);
        } catch (emailErr) {
            logger.error('Failed to send report email', emailErr);
        }

        result = { status: 'interaction reported successfully' };
      } else if (name === 'end_call') {
         result = { status: 'ending call in 10 seconds' };
         // Send function output first
         const functionOutput = {
            type: 'conversation.item.create',
            item: {
                type: 'function_call_output',
                call_id: callId,
                output: JSON.stringify(result)
            }
         };
         this.sendToOpenAI(functionOutput);
         // Trigger goodbye message
         this.sendToOpenAI({ type: 'response.create' });

         setTimeout(() => {
             if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                 this.ws.close();
             }
         }, 10000);
         return; // We handled the output sending manually above
      }

      // Send result back to OpenAI for other tools
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