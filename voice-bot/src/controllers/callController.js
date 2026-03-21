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
    const stream = connect.stream({
      url: `wss://${request.headers.host}/voice/stream`,
    });

    // Pass callerId and mode via Twilio Stream Parameters
    const callerId = (request.body && request.body.From) ? request.body.From : 'unknown';
    stream.parameter({ name: 'callerId', value: callerId });
    stream.parameter({ name: 'mode', value: 'inbound' });

    reply.type('text/xml');
    reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const handleStatusCallback = (request, reply) => {
  const { CallSid, CallStatus } = request.body;
  if (CallStatus === 'completed' || CallStatus === 'failed' || CallStatus === 'busy' || CallStatus === 'no-answer' || CallStatus === 'canceled') {
      logger.info(`Call ${CallSid} ended with status: ${CallStatus}`);
      markCallEnded(CallSid);
  }
  reply.send('');
};

export const handleWebSocket = (connection, req) => {
  logger.info('New WebSocket connection');
  const ws = connection.socket; // @fastify/websocket v11 uses connection.socket

  let callSid = 'unknown';
  let callerId = 'unknown';
  let mode = 'inbound';

  // We initialize the service later, when we have the stream parameters from Twilio
  let openAIService = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;

        // Retrieve parameters from start.customParameters
        if (data.start.customParameters) {
          callerId = data.start.customParameters.callerId || 'unknown';
          mode = data.start.customParameters.mode || 'inbound';
        }

        openAIService = new OpenAIRealtimeService(ws, callSid, callerId, mode);
        openAIService.connect(); // Connect to OpenAI only after we get the start message to be able to send custom initial system instructions

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
    if (openAIService && openAIService.openaiWs && openAIService.openaiWs.readyState === 1) {
        openAIService.openaiWs.close();
    }
  });
};
