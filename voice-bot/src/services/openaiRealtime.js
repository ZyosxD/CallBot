import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';
import { updateClientStatus, addLead, setCallActive, getClientById } from './dripService.js';

export class OpenAIRealtimeService {
  constructor(ws, callSid, clientId) {
    this.ws = ws;
    this.callSid = callSid;
    this.clientId = clientId === 'unknown' ? null : parseInt(clientId);
    this.openaiWs = null;
    this.streamSid = null;
    this.hasEnded = false;
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
        logger.info(`Connected to OpenAI Realtime API for call ${this.callSid}`);
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
        if (!this.hasEnded) {
            // If closed unexpectedly, treat as ended
            setCallActive(false);
        }
      });

    } catch (error) {
      logger.error('Error connecting to OpenAI:', error);
      setCallActive(false);
    }
  }

  sendSessionUpdate() {
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
        voice: 'coral',
        instructions: prompts.systemInstruction,
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Schedule a technical assessment when the user agrees and provides all details.",
            parameters: {
              type: "object",
              properties: {
                contactName: { type: "string", description: "Name of the contact person" },
                companyName: { type: "string", description: "Name of the company" },
                verbalPhone: { type: "string", description: "Phone number confirmed by the user" },
                appointmentTime: { type: "string", description: "Preferred date and time for the assessment" },
                notes: { type: "string", description: "Any additional notes or needs mentioned" }
              },
              required: ["contactName", "companyName", "verbalPhone", "appointmentTime"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report the outcome of the call if not interested, callback requested, or voicemail.",
            parameters: {
              type: "object",
              properties: {
                outcome: { type: "string", description: "The outcome (e.g., Not Interested, Callback, Voicemail)" },
                notes: { type: "string", description: "Any additional notes or reasons given" }
              },
              required: ["outcome"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call after saying goodbye.",
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
    const parsedArgs = JSON.parse(args);
    const callId = event.call_id;

    logger.info(`Function call detected: ${name} with args: ${args}`);
    let result = { status: 'success' };

    // Fetch client details if available
    let clientPhone = 'Unknown';
    if (this.clientId) {
        const client = await getClientById(this.clientId);
        if (client) clientPhone = client.phone;
    }

    try {
      if (name === 'schedule_appointment') {
        const leadData = {
            clientId: this.clientId,
            callerId: this.callSid,
            clientPhone: clientPhone,
            ...parsedArgs,
            timestamp: new Date().toISOString()
        };

        // Save lead
        await addLead(leadData);

        // Send email
        await sendSuccessEmail(leadData);

        if (this.clientId) {
            await updateClientStatus(this.clientId, 'APPOINTMENT');
        }

      } else if (name === 'report_interaction') {
         const reportData = {
             callerId: this.callSid,
             clientPhone: clientPhone,
             verbalPhone: parsedArgs.verbalPhone || 'Not provided',
             outcome: parsedArgs.outcome,
             notes: parsedArgs.notes
         };

         await sendReportEmail(reportData);

         if (this.clientId) {
             let status = 'COMPLETED'; // Default fallback
             const outcome = parsedArgs.outcome.toLowerCase();
             if (outcome.includes('interested')) status = 'REJECTED';
             else if (outcome.includes('callback')) status = 'CALLBACK';
             else if (outcome.includes('voicemail')) status = 'VOICEMAIL';
             else if (outcome.includes('appointment')) status = 'APPOINTMENT';

             await updateClientStatus(this.clientId, status);
         }

      } else if (name === 'end_call') {
        this.endCall("Bot requested end_call");
        result = { status: 'ending' };
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

      // Trigger response only if not ending?
      // Actually, standard is to trigger response so model can acknowledge or say goodbye if needed.
      // But if end_call was called, we might want to let it finish speaking then close.
      // The model typically says goodbye BEFORE calling end_call or as part of the turn.
      this.sendToOpenAI({ type: 'response.create' });

    } catch (error) {
      logger.error(`Error executing function ${name}:`, error);
    }
  }

  endCall(reason = "Normal completion") {
      if (this.hasEnded) return;
      this.hasEnded = true;
      logger.info(`Ending call: ${reason}`);

      // Spec: "Retardo de 10 segundos antes de cerrar el socket"
      setTimeout(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
              this.ws.close();
          }
          if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
              this.openaiWs.close();
          }
          setCallActive(false);
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
    } else if (data.event === 'media') {
        const audioAppend = {
            type: 'input_audio_buffer.append',
            audio: data.media.payload
        };
        this.sendToOpenAI(audioAppend);
    }
  }
}
