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

    // Inject callerId and mode for inbound calls
    const stream = connect.stream({
      url: `wss://${request.headers.host}/voice/stream`,
    });

    stream.parameter({
      name: 'callerId',
      value: (request.body && request.body.From) ? request.body.From : 'unknown'
    });
    stream.parameter({
      name: 'mode',
      value: 'SARAH_INBOUND'
    });

    reply.type('text/xml');
    reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.code(500).send('Internal Server Error');
  }
};

export const handleStatusCallback = (request, reply) => {
  try {
    const { CallSid, CallStatus } = request.body;
    logger.info(`Call status callback received for ${CallSid}: ${CallStatus}`);
    if (CallStatus === 'completed' || CallStatus === 'failed' || CallStatus === 'busy' || CallStatus === 'no-answer' || CallStatus === 'canceled') {
      markCallEnded(CallSid);
    }
    reply.send('OK');
  } catch (error) {
    logger.error('Error handling status callback:', error);
    reply.code(500).send('Internal Server Error');
  }
};

export const handleWebSocket = (connection, req) => {
  logger.info('New WebSocket connection');

  let callSid = 'unknown';
  let callerId = 'unknown';
  let mode = 'SARAH_INBOUND';

  // Extract from query params if possible, otherwise rely on start event
  if (req.query && req.query.callerId) callerId = req.query.callerId;
  if (req.query && req.query.mode) mode = req.query.mode;

  const openAIService = new OpenAIRealtimeService(connection.socket, callSid, callerId, mode);

  connection.socket.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;

        // Ensure accurate tracking of call parameters
        if (data.start.customParameters) {
            if (data.start.customParameters.callerId) {
                callerId = data.start.customParameters.callerId;
            }
            if (data.start.customParameters.mode) {
                mode = data.start.customParameters.mode;
            }
        }

        openAIService.callSid = callSid;
        openAIService.callerId = callerId;
        openAIService.mode = mode;

        openAIService.handleTwilioMedia(data);
        openAIService.connect(); // Connect to OpenAI after we receive Twilio start event
      } else if (data.event === 'media') {
        openAIService.handleTwilioMedia(data);
      } else if (data.event === 'stop') {
        logger.info(`Stream stopped for call ${callSid}`);
        connection.socket.close();
      }
    } catch (error) {
      logger.error('Error processing WebSocket message:', error);
    }
  });

  connection.socket.on('close', () => {
    logger.info('WebSocket connection closed');
    if (openAIService.openaiWs) {
        openAIService.openaiWs.close();
    }
  });
};
