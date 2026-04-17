import WebSocket from 'ws';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';
import { prompts } from '../config/prompts.js';
import fs from 'fs';
import path from 'path';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';

const leadsFilePath = path.join(process.cwd(), 'src', 'data', 'leads.json');
const interactionsFilePath = path.join(process.cwd(), 'src', 'data', 'interactions.json');

const appendToFile = (filePath, dataObj) => {
  try {
    let data = [];
    if (fs.existsSync(filePath)) {
      data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
    data.push(dataObj);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (error) {
    logger.error(`Error appending to ${filePath}:`, error);
  }
};

export class OpenAIRealtimeService {
  constructor(ws, callSid, mode, callerId) {
    this.twilioWs = ws;
    this.callSid = callSid;
    this.mode = mode;
    this.callerId = callerId;
    this.openaiWs = null;
    this.streamSid = null;
    this.isOpenAiConnected = false;
    this.isTwilioStarted = false;
  }

  connect() {
    const url = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview';
    this.openaiWs = new WebSocket(url, {
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
      try {
        const response = JSON.parse(data);
        this.handleOpenAIMessage(response);
      } catch (error) {
        logger.error('Error processing OpenAI message:', error);
      }
    });

    this.openaiWs.on('close', () => {
      logger.info('OpenAI Realtime API connection closed');
    });

    this.openaiWs.on('error', (error) => {
      logger.error('OpenAI WebSocket error:', error);
    });
  }

  checkAndInitializeSession() {
    if (this.isOpenAiConnected && this.isTwilioStarted) {
      this.sendSessionUpdate();

      // Start the conversation immediately with a greeting event
      const greetingEvent = {
        type: 'response.create',
        response: {
          instructions: 'Start the conversation immediately by greeting the user and asking if they handle technology or if you should speak with the Office Manager.'
        }
      };
      this.openaiWs.send(JSON.stringify(greetingEvent));
    }
  }

  sendSessionUpdate() {
    const systemPrompt = this.mode === 'outbound' ? prompts.SARAH_OUTBOUND : prompts.SARAH_INBOUND;
    const sessionUpdate = {
      type: 'session.update',
      session: {
        voice: 'coral',
        instructions: systemPrompt,
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 1500
        },
        tools: [
          {
            type: 'function',
            name: 'schedule_appointment',
            description: 'Triggers when the client agrees to a Technical Assessment. Collects Contact Name, Company Name, Verified Phone, and Appointment Time.',
            parameters: {
              type: 'object',
              properties: {
                contactName: { type: 'string', description: 'Name of the contact person' },
                companyName: { type: 'string', description: 'Name of the company' },
                confirmedPhone: { type: 'string', description: 'Verbally confirmed phone number' },
                appointmentTime: { type: 'string', description: 'Agreed time for the appointment' },
                needs: { type: 'string', description: 'Any technical needs or notes discussed' }
              },
              required: ['contactName', 'companyName', 'confirmedPhone', 'appointmentTime']
            }
          },
          {
            type: 'function',
            name: 'report_interaction',
            description: 'Triggers when the client is not interested, asks to call back later, or if voicemail is reached.',
            parameters: {
              type: 'object',
              properties: {
                status: { type: 'string', description: 'Status of the call, e.g., Not Interested, Callback Later, Voicemail' },
                reason: { type: 'string', description: 'Brief reason or note about the interaction' }
              },
              required: ['status', 'reason']
            }
          },
          {
            type: 'function',
            name: 'end_call',
            description: 'Triggers when the conversation is completely finished and it is time to say goodbye and hang up.',
            parameters: {
              type: 'object',
              properties: {},
            }
          }
        ],
        tool_choice: 'auto'
      }
    };
    this.openaiWs.send(JSON.stringify(sessionUpdate));
  }

  handleTwilioMedia(data) {
    if (data.event === 'start') {
      this.streamSid = data.start.streamSid;
      this.isTwilioStarted = true;
      this.checkAndInitializeSession();
    } else if (data.event === 'media' && this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
      const audioEvent = {
        type: 'input_audio_buffer.append',
        audio: data.media.payload
      };
      this.openaiWs.send(JSON.stringify(audioEvent));
    }
  }

  handleOpenAIMessage(response) {
    if (response.type === 'response.audio.delta' && response.delta) {
      const audioPayload = {
        event: 'media',
        streamSid: this.streamSid,
        media: {
          payload: response.delta
        }
      };
      this.twilioWs.send(JSON.stringify(audioPayload));
    }

    if (response.type === 'response.function_call_arguments.done') {
      this.handleFunctionCall(response);
    }
  }

  async handleFunctionCall(response) {
    const { name, arguments: args, call_id } = response;
    logger.info(`Function call requested: ${name}`);

    let parsedArgs;
    try {
      parsedArgs = JSON.parse(args);
    } catch (e) {
      logger.error('Error parsing function arguments:', e);
      // Resolve the tool call with error
      const toolResponse = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: call_id,
          output: JSON.stringify({ error: 'Invalid arguments format' })
        }
      };
      this.openaiWs.send(JSON.stringify(toolResponse));
      return;
    }

    if (name === 'schedule_appointment') {
      const details = { ...parsedArgs, callerId: this.callerId, timestamp: new Date().toISOString() };
      appendToFile(leadsFilePath, details);
      await sendSuccessEmail(details);

      const toolResponse = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: call_id,
          output: JSON.stringify({ success: true, message: 'Appointment scheduled successfully.' })
        }
      };
      this.openaiWs.send(JSON.stringify(toolResponse));

    } else if (name === 'report_interaction') {
      const details = { ...parsedArgs, callerId: this.callerId, timestamp: new Date().toISOString() };
      appendToFile(interactionsFilePath, details);
      await sendReportEmail(details);

      const toolResponse = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: call_id,
          output: JSON.stringify({ success: true, message: 'Interaction reported successfully.' })
        }
      };
      this.openaiWs.send(JSON.stringify(toolResponse));

    } else if (name === 'end_call') {
      logger.info('Ending call as requested by AI');

      // Acknowledge the tool call to prevent hanging
      const toolResponse = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: call_id,
          output: JSON.stringify({ success: true, message: 'Initiating call wrap-up.' })
        }
      };
      this.openaiWs.send(JSON.stringify(toolResponse));

      // Instruct the AI to say a final goodbye
      const goodbyeEvent = {
        type: 'response.create',
        response: {
          instructions: 'Say a short, polite goodbye.'
        }
      };
      this.openaiWs.send(JSON.stringify(goodbyeEvent));

      // Delay closing to allow goodbye audio to finish streaming
      setTimeout(() => {
        if (this.twilioWs && this.twilioWs.readyState === WebSocket.OPEN) {
          logger.info('Closing WebSocket after goodbye delay');
          this.twilioWs.close();
        }
      }, 10000);
    }
  }
}
