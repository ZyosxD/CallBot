import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { markCallEnded } from '../services/dripService.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = async (request, reply) => {
  try {
    logger.info('Incoming call request received');
    const response = new VoiceResponse();
    const connect = response.connect();

    // Extract mode and callerId
    let mode = request.query.mode || 'inbound';
    let callerId = 'unknown';

    if (mode === 'outbound') {
      callerId = request.query.callerId || 'unknown';
    } else {
      callerId = (request.body && request.body.From) ? request.body.From : 'unknown';
    }

    const stream = connect.stream({
      url: `wss://${request.headers.host}/voice/stream`,
    });

    stream.parameter({ name: 'mode', value: mode });
    stream.parameter({ name: 'callerId', value: callerId });

    reply.type('text/xml');
    return reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    return reply.code(500).send('Internal Server Error');
  }
};

export const handleStatusCallback = async (request, reply) => {
  const callSid = request.body?.CallSid;
  const status = request.body?.CallStatus;

  if (callSid && (status === 'completed' || status === 'failed' || status === 'busy' || status === 'no-answer' || status === 'canceled')) {
    markCallEnded(callSid);
  }
  return reply.code(200).send();
};

export const handleWebSocket = (connection, request) => {
  logger.info('New WebSocket connection');

  // Safely get websocket instance from connection for fastify/websocket v11
  const ws = connection.socket ? connection.socket : connection;

  let callSid = 'unknown';
  let callerId = 'unknown';
  let mode = 'inbound';

  const openAIService = new OpenAIRealtimeService(ws, callSid, callerId, mode);
  openAIService.connect();

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;
        openAIService.callSid = callSid;

        // Read custom parameters
        const customParams = data.start.customParameters || {};
        if (customParams.mode) mode = customParams.mode;
        if (customParams.callerId) callerId = customParams.callerId;

        openAIService.mode = mode;
        openAIService.callerId = callerId;

        openAIService.handleTwilioMedia(data);
      } else if (data.event === 'media') {
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
    if (openAIService.openaiWs) {
        openAIService.openaiWs.close();
    }
  });
};
