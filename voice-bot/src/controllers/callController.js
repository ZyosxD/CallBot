import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { handleCallEnd } from '../services/dripService.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = (request, reply) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();

    // The websocket connection URL needs to match the Fastify router path
    const wssUrl = `wss://${request.headers.host}/voice/stream`;

    const stream = connect.stream({
      url: wssUrl,
    });

    // Inject caller ID and mode for receptionist
    stream.parameter({
        name: 'callerId',
        value: request.body.From || 'unknown'
    });
    stream.parameter({
        name: 'mode',
        value: 'inbound'
    });

    reply.type('text/xml');
    reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const handleStatusCallback = (request, reply) => {
    try {
        const { CallStatus, CallSid } = request.body;
        logger.info(`Call ${CallSid} status update: ${CallStatus}`);

        if (CallStatus === 'completed' || CallStatus === 'failed' || CallStatus === 'busy' || CallStatus === 'no-answer' || CallStatus === 'canceled') {
            handleCallEnd(CallSid);
        }

        reply.send();
    } catch (error) {
        logger.error('Error handling status callback:', error);
        reply.status(500).send('Internal Server Error');
    }
};

export const handleWebSocket = (ws, req) => {
  logger.info('New WebSocket connection');

  let callSid = 'unknown';
  let callerId = 'unknown';
  let mode = 'inbound';
  let openAIService = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;

        // Extract parameters injected in TwiML
        if (data.start.customParameters) {
            callerId = data.start.customParameters.callerId || callerId;
            mode = data.start.customParameters.mode || mode;
        }

        openAIService = new OpenAIRealtimeService(ws, callSid, callerId, mode);
        openAIService.connect();
        openAIService.handleTwilioMedia(data);
      } else if (data.event === 'media') {
        if (openAIService) {
            openAIService.handleTwilioMedia(data);
        }
      } else if (data.event === 'stop') {
        logger.info(`Stream stopped for call ${callSid}`);
        ws.close();
      }
    } catch (error) {
      logger.error('Error processing WebSocket message:', error);
    }
  });

  ws.on('close', () => {
    logger.info('WebSocket connection closed');
    if (openAIService && openAIService.openaiWs) {
        openAIService.openaiWs.close();
    }
  });
};