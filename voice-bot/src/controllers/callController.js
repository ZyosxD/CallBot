import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { markCallEnded } from '../services/dripService.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = (req, reply) => {
  try {
    const callerId = req.query.callerId || (req.body && req.body.From) || 'unknown';
    const mode = req.query.mode || 'inbound';

    logger.info(`Incoming ${mode} call received from ${callerId}`);

    const response = new VoiceResponse();
    const connect = response.connect();

    // Construct the stream parameters
    const stream = connect.stream({
      url: `wss://${req.headers.host}/voice/stream`,
    });

    stream.parameter({
      name: 'callerId',
      value: callerId
    });

    stream.parameter({
      name: 'mode',
      value: mode
    });

    reply.type('text/xml').send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.code(500).send('Internal Server Error');
  }
};

export const statusCallback = (req, reply) => {
  const { CallSid, CallStatus } = req.body;
  logger.info(`Call Status Update: SID ${CallSid} is now ${CallStatus}`);

  if (CallStatus === 'completed' || CallStatus === 'failed' || CallStatus === 'busy' || CallStatus === 'no-answer' || CallStatus === 'canceled') {
    markCallEnded(CallSid);
  }

  reply.code(200).send('OK');
};

export const handleWebSocket = (connection, req) => {
  logger.info('New WebSocket connection');

  // The connection object in fastify/websocket v11 contains the socket itself
  const ws = connection;
  let callSid = 'unknown';
  let openAIService = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;

        // Extract parameters from start event
        const callerId = data.start.customParameters?.callerId || 'unknown';
        const mode = data.start.customParameters?.mode || 'inbound';

        logger.info(`Starting OpenAI Realtime Service for call ${callSid} (${mode}) from ${callerId}`);
        openAIService = new OpenAIRealtimeService(ws, callSid, callerId, mode);
        openAIService.connect();

        // Let the service know about the stream sid
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
