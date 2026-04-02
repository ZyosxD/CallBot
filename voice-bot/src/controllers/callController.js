import twilio from 'twilio';
import logger from '../utils/logger.js';
import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import { markCallEnded } from '../services/dripService.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = (request, reply) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();

    const callerId = (request.body && request.body.From) ? request.body.From : 'unknown';

    const stream = connect.stream({
      url: `wss://${request.headers.host}/voice/stream`,
    });

    stream.parameter({ name: 'mode', value: 'inbound' });
    stream.parameter({ name: 'callerId', value: callerId });

    reply.type('text/xml');
    reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const handleWebSocket = (connection, req) => {
  logger.info('New WebSocket connection');
  const ws = connection.socket ? connection.socket : connection;

  let callSid = 'unknown';
  let callerId = 'unknown';
  let mode = 'inbound';

  // We initialize the OpenAI service, but delay connecting to openai slightly
  // until we receive the start message, or we can instantiate inside the 'start' event.
  let openAIService = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;

        if (data.start.customParameters) {
            callerId = data.start.customParameters.callerId || 'unknown';
            mode = data.start.customParameters.mode || 'inbound';
        }

        logger.info(`Stream started for call ${callSid}, mode: ${mode}, callerId: ${callerId}`);
        openAIService = new OpenAIRealtimeService(ws, callSid, callerId, mode);
        openAIService.connect();
        openAIService.handleTwilioMedia(data);

      } else if (data.event === 'media' && openAIService) {
        openAIService.handleTwilioMedia(data);
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

export const handleStatusCallback = (request, reply) => {
  const callSid = request.body.CallSid;
  const status = request.body.CallStatus;

  logger.info(`Call Status Update: ${callSid} is now ${status}`);

  if (status === 'completed' || status === 'failed' || status === 'busy' || status === 'no-answer' || status === 'canceled') {
    markCallEnded(callSid);
  }

  reply.send('OK');
};
