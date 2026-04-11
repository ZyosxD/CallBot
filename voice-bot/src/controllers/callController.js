import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = (request, reply) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();

    // Safely extract callerId using optional chaining for Fastify request
    const callerId = request.query?.callerId || request.body?.From || 'unknown';

    const stream = connect.stream({
      url: `wss://${request.headers.host}/voice/stream`,
    });

    reply.type('text/xml');
    reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const inboundStatus = async (request, reply) => {
  const callSid = request.body?.CallSid;
  const status = request.body?.CallStatus;
  logger.info(`Call status update received. CallSid: ${callSid}, Status: ${status}`);

  if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(status)) {
    try {
      const { markCallEnded } = await import('../services/dripService.js');
      markCallEnded(callSid);
    } catch (error) {
      logger.error('Error importing or calling markCallEnded:', error);
    }
  }

  reply.code(200).send('OK');
};

export const handleWebSocket = (connection, request) => {
  // Extract WebSocket instance in Fastify v11
  const ws = connection.socket ? connection.socket : connection;
  logger.info('New WebSocket connection');

  let callSid = 'unknown';

  const openAIService = new OpenAIRealtimeService(ws, callSid);
  openAIService.connect();

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;
        openAIService.callSid = callSid;

        // Also track callerId for accurate reporting
        const callerId = request.query?.callerId || request.body?.From || 'unknown';
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

  ws.on('close', async () => {
    logger.info('WebSocket connection closed');
    if (openAIService.openaiWs) {
        openAIService.openaiWs.close();
    }

    // Attempt to release the outbound lock if this was an outbound call that ended unexpectedly
    try {
      if (callSid && callSid !== 'unknown') {
        const { markCallEnded } = await import('../services/dripService.js');
        markCallEnded(callSid);
      }
    } catch (error) {
      logger.error('Error calling markCallEnded on ws close:', error);
    }
  });
};
