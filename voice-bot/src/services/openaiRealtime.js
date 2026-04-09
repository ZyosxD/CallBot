import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class OpenAIRealtimeService {
  constructor(ws) {
    this.ws = ws;
    this.callSid = 'unknown';
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
    const systemInstruction = this.mode === 'inbound' ? prompts.SARAH_INBOUND : prompts.SARAH_OUTBOUND;

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
        instructions: systemInstruction,
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Agendar una Evaluación Técnica para Internet, VoIP o IT. Solo usar cuando el cliente acepta y proporciona todos los datos.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Nombre del contacto (Dueño o IT Manager)" },
                companyName: { type: "string", description: "Nombre de la empresa" },
                confirmedPhone: { type: "string", description: "Teléfono confirmado verbalmente por el cliente" },
                appointmentTime: { type: "string", description: "Día y hora exacta acordada para la cita" }
              },
              required: ["contactName", "companyName", "confirmedPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Reportar el resultado de la llamada cuando el cliente no está interesado, pide llamar luego o contesta buzón de voz.",
            parameters: {
              type: "object",
              properties: {
                outcome: { type: "string", description: "Resultado: NO_INTERESADO, LLAMAR_LUEGO, BUZON" },
                notes: { type: "string", description: "Notas adicionales de la interacción" }
              },
              required: ["outcome"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "Finalizar la llamada de forma respetuosa.",
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

    // Initial greeting instruction to trigger AI speech
    this.sendToOpenAI({
        type: 'response.create',
        response: {
            instructions: "Start the conversation immediately by greeting the user and executing your initial prompt instructions."
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
    const callId = event.call_id;
    let result = null;

    logger.info(`Function call detected: ${name} with args: ${args}`);

    let parsedArgs;
    try {
        parsedArgs = JSON.parse(args);
    } catch (e) {
        logger.error(`SyntaxError parsing JSON arguments for tool ${name}:`, e);
        parsedArgs = {};
    }

    try {
      if (name === 'schedule_appointment') {
        const leadData = {
            id: Date.now().toString(),
            callSid: this.callSid,
            callerId: this.callerId, // original twilio/client phone
            ...parsedArgs,
            timestamp: new Date().toISOString()
        };

        // Save to leads.json
        const leadsPath = path.join(__dirname, '../data/leads.json');
        let leads = [];
        if (fs.existsSync(leadsPath)) {
            leads = JSON.parse(fs.readFileSync(leadsPath, 'utf-8'));
        }
        leads.push(leadData);
        fs.writeFileSync(leadsPath, JSON.stringify(leads, null, 2));

        // Call email service
        try {
            const { sendSuccessEmail } = await import('./emailService.js');
            await sendSuccessEmail(leadData);
        } catch (e) {
            logger.error('Error sending success email:', e);
        }

        result = { status: 'success', message: 'Appointment scheduled successfully.' };

      } else if (name === 'report_interaction') {
        const interactionData = {
            id: Date.now().toString(),
            callSid: this.callSid,
            callerId: this.callerId,
            ...parsedArgs,
            timestamp: new Date().toISOString()
        };

        // Save to interactions.json
        const interactionsPath = path.join(__dirname, '../data/interactions.json');
        let interactions = [];
        if (fs.existsSync(interactionsPath)) {
            interactions = JSON.parse(fs.readFileSync(interactionsPath, 'utf-8'));
        }
        interactions.push(interactionData);
        fs.writeFileSync(interactionsPath, JSON.stringify(interactions, null, 2));

        // Call email service
        try {
            const { sendReportEmail } = await import('./emailService.js');
            await sendReportEmail(interactionData);
        } catch (e) {
            logger.error('Error sending report email:', e);
        }

        result = { status: 'success', message: 'Interaction reported successfully.' };

      } else if (name === 'end_call') {
        logger.info(`End call requested for ${this.callSid}. Waiting 10s before disconnect.`);

        // Instruct to say goodbye before we close
        this.sendToOpenAI({
            type: 'response.create',
            response: {
                instructions: "Say a short, polite goodbye immediately."
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

        result = { status: 'success', message: 'Ending call in 10 seconds.' };
      }

      // Send result back to OpenAI to resolve the tool call
      const functionOutput = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify(result)
        }
      };
      this.sendToOpenAI(functionOutput);

      // Do NOT trigger an immediate response.create for end_call to prevent hallucination loop
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
      this.callSid = data.start.callSid; // correctly assign CallSid
      this.isTwilioStarted = true;
      logger.info(`Stream started: ${this.streamSid} for CallSid: ${this.callSid}`);
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
