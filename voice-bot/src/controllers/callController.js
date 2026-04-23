import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = async (request, reply) => {
  try {
    logger.info('Incoming call received');
    const callerId = request.body?.From || 'unknown';
    const mode = 'inbound';

    const response = new VoiceResponse();
    const connect = response.connect();
    const stream = connect.stream({
      url: `wss://${request.headers.host}/voice/stream`,
    });

    stream.parameter({ name: 'callerId', value: callerId });
    stream.parameter({ name: 'mode', value: mode });

    reply.type('text/xml');
    return reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    return reply.status(500).send('Internal Server Error');
  }
};

export const outboundCall = async (request, reply) => {
    try {
      logger.info('Outbound call answered by client');
      // callerId and mode passed via URL query params from dripService
      const callerId = request.query?.callerId || 'unknown';
      const mode = request.query?.mode || 'outbound';

      const response = new VoiceResponse();
      const connect = response.connect();
      const stream = connect.stream({
        url: `wss://${request.headers.host}/voice/stream`,
      });

      stream.parameter({ name: 'callerId', value: callerId });
      stream.parameter({ name: 'mode', value: mode });

      reply.type('text/xml');
      return reply.send(response.toString());
    } catch (error) {
      logger.error('Error handling outbound call:', error);
      return reply.status(500).send('Internal Server Error');
    }
  };

export const inboundStatus = async (request, reply) => {
    try {
        const { CallSid, CallStatus } = request.body;
        logger.info(`Call ${CallSid} changed status to: ${CallStatus}`);

        if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(CallStatus)) {
            const { markCallEnded } = await import('../services/dripService.js');
            markCallEnded(CallSid);
        }

        return reply.status(200).send('OK');
    } catch (error) {
        logger.error('Error handling call status:', error);
        return reply.status(500).send('Internal Server Error');
    }
};

export const handleWebSocket = (connection, request) => {
  const ws = connection.socket ? connection.socket : connection;
  logger.info('New WebSocket connection');

  let callSid = 'unknown';
  let openAIService = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;
        const customParams = data.start.customParameters || {};
        const callerId = customParams.callerId || 'unknown';
        const mode = customParams.mode || 'inbound';

        logger.info(`Stream started for call ${callSid}. Mode: ${mode}, CallerID: ${callerId}`);
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

  ws.on('close', async () => {
    logger.info(`WebSocket connection closed for call ${callSid}`);
    if (openAIService && openAIService.openaiWs) {
        openAIService.openaiWs.close();
    }
    const { markCallEnded } = await import('../services/dripService.js');
    markCallEnded(callSid);
  });
};
