import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = async (request, reply) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();

    // Safely extract host depending on the request object structure
    const host = request.headers.host;
    connect.stream({
      url: `wss://${host}/voice/stream`,
    });

    reply.type('text/xml').send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const inboundStatus = async (request, reply) => {
    try {
        const { CallSid, CallStatus } = request.body || {};
        logger.info(`Call status update received: ${CallSid} is now ${CallStatus}`);

        // Terminate states according to Twilio: 'completed', 'busy', 'failed', 'no-answer', 'canceled'
        if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(CallStatus)) {
            const { markCallEnded } = await import('../services/dripService.js');
            markCallEnded(CallSid);
        }

        reply.status(200).send('OK');
    } catch (error) {
        logger.error('Error handling call status:', error);
        reply.status(500).send('Internal Server Error');
    }
};

export const handleWebSocket = (connection, request) => {
  logger.info('New WebSocket connection');

  // Support @fastify/websocket v11 API where connection is an object with .socket or the socket itself
  const ws = connection.socket ? connection.socket : connection;

  const mode = request.query?.mode || 'inbound';
  const callerId = request.query?.callerId || request.body?.From || 'unknown';

  const openAIService = new OpenAIRealtimeService(ws, mode, callerId);
  openAIService.connect();

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        openAIService.handleTwilioMedia(data);
      } else if (data.event === 'media') {
        openAIService.handleTwilioMedia(data);
      } else if (data.event === 'stop') {
        logger.info(`Stream stopped for call ${openAIService.callSid}`);
        ws.close();
      }
    } catch (error) {
      logger.error('Error processing WebSocket message:', error);
    }
  });

  ws.on('close', async () => {
    logger.info('WebSocket connection closed');

    // Attempt to release the lock forcefully
    if (openAIService.callSid) {
        try {
            const { markCallEnded } = await import('../services/dripService.js');
            markCallEnded(openAIService.callSid);
        } catch (err) {
            logger.error('Error importing dripService to release lock:', err);
        }
    }

    if (openAIService.openaiWs) {
        openAIService.openaiWs.close();
    }
  });
};
