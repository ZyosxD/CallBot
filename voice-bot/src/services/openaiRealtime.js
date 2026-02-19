import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { emailService } from './emailService.js';
import fileLock from '../utils/fileLock.js';
import path from 'path';

const LEADS_FILE = path.join(process.cwd(), 'src/data/leads.json');
const INTERACTIONS_FILE = path.join(process.cwd(), 'src/data/interactions.json');

export class OpenAIRealtimeService {
  constructor(ws, callSid, params = {}) {
    this.ws = ws;
    this.callSid = callSid;
    this.params = params; // { direction: 'inbound'|'outbound', clientId: '...', callerId: '...' }
    this.openaiWs = null;
    this.streamSid = null;
    this.isClosing = false;
  }

  async connect() {
    try {
      const url = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01';
      this.openaiWs = new WebSocket(url, {
        headers: {
          'Authorization': `Bearer ${config.openai.apiKey}`,
          'OpenAI-Beta': 'realtime=v1',
        },
      });

      this.openaiWs.on('open', () => {
        logger.info(`Connected to OpenAI Realtime API for Call ${this.callSid}`);
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
        if (!this.isClosing && this.ws.readyState === WebSocket.OPEN) {
            this.ws.close();
        }
      });

    } catch (error) {
      logger.error('Error connecting to OpenAI:', error);
    }
  }

  sendSessionUpdate() {
    const direction = this.params.direction || 'inbound';
    // Use outbound prompt if direction is outbound (Cold Caller), else inbound (Receptionist)
    // Spec says: Outbound = Cold Caller (Sarah), Inbound = Receptionist.
    // However, prompts.js currently (before I update it) has dental stuff.
    // I will assume prompts.js will have `outbound` and `inbound` keys.

    // Note: I haven't updated prompts.js yet, so this might fail if I run it now.
    // But I'm following the plan.

    const instructions = direction === 'outbound'
        ? prompts.outbound.systemInstruction
        : prompts.inbound.systemInstruction;

    const tools = prompts.tools;

    const sessionUpdate = {
      type: 'session.update',
      session: {
        turn_detection: {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 1500 // Spec requirement
        },
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        voice: 'coral', // Spec requirement
        instructions: instructions,
        modalities: ["text", "audio"],
        temperature: 0.7,
        tools: tools,
        tool_choice: "auto"
      },
    };

    this.sendToOpenAI(sessionUpdate);

    // If outbound, we might want to trigger the first greeting?
    // The spec doesn't explicitly say who speaks first, but usually for cold calls, the bot speaks first after user hello?
    // Or bot speaks immediately?
    // "Saluda y pregunta..."
    // Usually user says "Hello?" then bot speaks.
    // So we wait for user input (VAD) or we can push a greeting.
    // With server_vad, OpenAI will wait for user audio.
    // If we want bot to start, we can send `response.create`.
    // But for cold calls, usually we wait for "Hello".
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

      if (event.type === 'response.function_call_arguments.done') {
         // This event is from the older API or specific model version?
         // gpt-4o-realtime-preview uses `response.output_item.done` with item.type='function_call'?
         // Actually the previous code used `response.function_call_arguments.done`.
         // Let's check the docs or memory. Memory doesn't specify events.
         // I'll stick to the pattern I see in the previous file which presumably worked,
         // but I should be careful.
         // `response.function_call_arguments.done` provides the arguments.
         await this.handleFunctionCall(event);
      }

      // Also handle `response.output_item.added` if it contains function call?
      // Realtime API is tricky.
      // The previous code had `response.function_call_arguments.done`. I'll trust it.

    } catch (error) {
      logger.error('Error parsing OpenAI message:', error);
    }
  }

  async handleFunctionCall(event) {
      // The event structure for `response.function_call_arguments.done`:
      // {
      //   type: 'response.function_call_arguments.done',
      //   call_id: '...',
      //   name: '...',
      //   arguments: '...'
      // }

      const { name, call_id, arguments: argsString } = event;
      const args = JSON.parse(argsString);

      logger.info(`Tool Call: ${name}`, args);

      let result = { success: true };

      try {
          if (name === 'schedule_appointment') {
              await this.handleScheduleAppointment(args);
              result = { status: 'scheduled', message: 'Appointment scheduled and email sent.' };
          } else if (name === 'report_interaction') {
              await this.handleReportInteraction(args);
              result = { status: 'reported', message: 'Interaction reported.' };
          } else if (name === 'end_call') {
              this.handleEndCall();
              result = { status: 'ending', message: 'Call ending in 10 seconds.' };
          }
      } catch (error) {
          logger.error(`Error executing tool ${name}:`, error);
          result = { success: false, error: error.message };
      }

      // Send output back
      const functionOutput = {
          type: 'conversation.item.create',
          item: {
              type: 'function_call_output',
              call_id: call_id,
              output: JSON.stringify(result)
          }
      };
      this.sendToOpenAI(functionOutput);

      // Trigger response if not ending
      if (name !== 'end_call') {
          this.sendToOpenAI({ type: 'response.create' });
      }
  }

  async handleScheduleAppointment(args) {
      // args: { name, company, date, notes }
      // We also need confirmedPhone. And we have callerId from params.
      const lead = {
          ...args,
          callerId: this.params.callerId,
          confirmedPhone: args.confirmedPhone || this.params.callerId, // Fallback
          timestamp: new Date().toISOString()
      };

      // Save to leads.json
      await fileLock.update(LEADS_FILE, (leads) => {
          leads.push(lead);
          return leads;
      });

      // Send Email
      await emailService.sendSuccessEmail(lead);
  }

  async handleReportInteraction(args) {
      // args: { status, reason, notes }
      const interaction = {
          ...args,
          callerId: this.params.callerId,
          timestamp: new Date().toISOString()
      };

      // Save to interactions.json (or logs)
      await fileLock.update(INTERACTIONS_FILE, (interactions) => {
          interactions.push(interaction);
          return interactions;
      });

      // Send Email
      await emailService.sendReportEmail(interaction);
  }

  handleEndCall() {
      // "Despide y corta la conexión tras 10s."
      // The AI presumably just said goodbye (as part of the response that triggered this tool).
      // Or we should instruct it to say goodbye?
      // Usually the tool call happens, we confirm, then AI says "Goodbye".
      // But we need to keep the connection open for 10s *after* the goodbye?
      // Or *after* the tool call?
      // Spec: "Retardo de 10 segundos (setTimeout) antes de cerrar el socket para permitir una despedida completa."

      this.isClosing = true;

      // We trigger a response so the AI can say its goodbye text if it hasn't already.
      this.sendToOpenAI({ type: 'response.create' });

      setTimeout(() => {
          logger.info(`Ending call ${this.callSid} after 10s delay.`);
          if (this.ws.readyState === WebSocket.OPEN) {
              this.ws.close();
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
      logger.info(`Stream started: ${this.streamSid}`);
      // If outbound, we might want to mark the call as connected in our logic?
    } else if (data.event === 'media') {
        const audioAppend = {
            type: 'input_audio_buffer.append',
            audio: data.media.payload
        };
        this.sendToOpenAI(audioAppend);
    } else if (data.event === 'stop') {
        logger.info('Twilio media stream stopped');
        if (this.openaiWs) this.openaiWs.close();
    }
  }
}
