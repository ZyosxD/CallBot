import WebSocket from 'ws';
import { config } from '../config/config.js';
import { prompts } from '../config/prompts.js';
import logger, { logConversation } from '../utils/logger.js';
import { saveLead, logInteraction } from './leadService.js';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';
import { setCallInProgress } from './scheduler.js';

export class OpenAIRealtimeService {
  constructor(ws, callSid, callType = 'INBOUND', clientData = null) {
    this.ws = ws;
    this.callSid = callSid;
    this.callType = callType;
    this.clientData = clientData;
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
        if (this.callType === 'OUTBOUND') {
            setCallInProgress(false);
        }
      });

    } catch (error) {
      logger.error('Error connecting to OpenAI:', error);
    }
  }

  sendSessionUpdate() {
    let specificScript = '';
    if (this.callType === 'OUTBOUND' && this.clientData) {
        specificScript = prompts.outboundScript
            .replace('[Name]', this.clientData.name || 'there')
            .replace('[Company Name]', this.clientData.company || 'your company');
    } else {
        specificScript = prompts.inboundScript;
    }

    const fullInstructions = `${prompts.systemInstruction}\n\n${specificScript}`;

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
        instructions: fullInstructions,
        modalities: ["text", "audio"],
        temperature: 0.8,
        tools: [
          {
            type: "function",
            name: "schedule_appointment",
            description: "Schedule a Technical Assessment. Use ONLY when you have Name, Company, Verified Phone, and Time.",
            parameters: {
              type: "object",
              properties: {
                name: { type: "string", description: "Contact Name" },
                company: { type: "string", description: "Company Name" },
                phone: { type: "string", description: "Verified Phone Number" },
                time: { type: "string", description: "Appointment Date and Time" }
              },
              required: ["name", "company", "phone", "time"]
            }
          },
          {
            type: "function",
            name: "report_interaction",
            description: "Report the outcome of the call if no appointment was made (Not interested, Call back later, Voicemail).",
            parameters: {
              type: "object",
              properties: {
                status: { type: "string", enum: ["NOT_INTERESTED", "CALL_BACK_LATER", "VOICEMAIL", "OTHER"] },
                reason: { type: "string", description: "Reason or notes about the interaction" }
              },
              required: ["status", "reason"]
            }
          },
          {
            type: "function",
            name: "end_call",
            description: "End the call. Use this when the conversation is finished.",
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

    if (this.callType === 'OUTBOUND') {
        setTimeout(() => {
            this.sendToOpenAI({
                type: 'response.create',
                response: {
                    instructions: `Start the call immediately using the Outbound Script. Say the first line: "Hi, is this ${this.clientData?.name || 'there'}?"`
                }
            });
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
    const parsedArgs = JSON.parse(args);
    const callId = event.call_id;

    logger.info(`Function call detected: ${name} with args: ${args}`);
    let result = null;

    try {
      if (name === 'schedule_appointment') {
        const appointmentData = {
            ...parsedArgs,
            callerId: this.clientData?.phone || 'Inbound',
            source: this.callType
        };
        await saveLead(appointmentData);
        await sendSuccessEmail(appointmentData);
        result = { success: true, message: "Appointment scheduled and email sent." };

      } else if (name === 'report_interaction') {
        const reportData = {
            ...parsedArgs,
            phone: this.clientData?.phone || 'Inbound',
            callerId: this.clientData?.phone || 'Inbound',
            source: this.callType
        };
        await logInteraction(reportData);
        await sendReportEmail(reportData);
        result = { success: true, message: "Interaction reported." };

      } else if (name === 'end_call') {
        logger.info('Agent requested to end call.');
        result = { success: true, message: "Ending call in 10 seconds." };

        // Schedule disconnect
        setTimeout(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.close();
            }
             if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
                this.openaiWs.close();
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
