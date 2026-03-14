import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { markCallEnded } from '../services/dripService.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = (request, reply) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();

    // Add stream with inbound mode and callerId parameters
    const stream = connect.stream({
      url: `wss://${request.headers.host}/voice/stream`,
    });

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

export const handleWebSocket = (ws, req) => {
  logger.info('New WebSocket connection');

  // We wait for the 'start' event from Twilio to get parameters
  let callSid = 'unknown';
  let openAIService = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;

        // Extract parameters injected via TwiML
        const params = data.start.customParameters || {};
        const callerId = params.callerId || 'unknown';
        const mode = params.mode || 'inbound';

        logger.info(`Call started: ${callSid}, Mode: ${mode}, CallerId: ${callerId}`);

        openAIService = new OpenAIRealtimeService(ws, callSid, callerId, mode);
        openAIService.connect();
        openAIService.handleTwilioMedia(data);

      } else if (data.event === 'media' && openAIService) {
        openAIService.handleTwilioMedia(data);
      } else if (data.event === 'stop') {
        logger.info(`Stream stopped for call ${callSid}`);
        if (openAIService) {
          openAIService.handleTwilioMedia(data);
        }
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

export const statusCallback = (request, reply) => {
  const { CallSid, CallStatus } = request.body;
  logger.info(`Call status update: ${CallSid} -> ${CallStatus}`);

  if (['completed', 'failed', 'busy', 'no-answer', 'canceled'].includes(CallStatus)) {
    markCallEnded(CallSid);
  }

  reply.status(200).send('OK');
};
