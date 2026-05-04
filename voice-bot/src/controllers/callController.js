import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = async (request, reply) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();

    const stream = connect.stream({
      url: `wss://${request.headers.host}/voice/stream`,
    });

    const isOutbound = request.body?.Direction === 'outbound-api';
    const callerId = isOutbound ? request.body?.To : request.body?.From;
    const mode = isOutbound ? 'outbound' : 'inbound';

    stream.parameter({ name: 'callerId', value: callerId || 'Unknown' });
    stream.parameter({ name: 'mode', value: mode });

    reply.type('text/xml').send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const inboundStatus = async (request, reply) => {
    try {
        const callSid = request.body?.CallSid;
        const callStatus = request.body?.CallStatus;

        logger.info(`Call status update for ${callSid}: ${callStatus}`);

        if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(callStatus)) {
            const { markCallEnded } = await import('../services/dripService.js');
            markCallEnded(callSid);
        }

        reply.status(200).send('OK');
    } catch (error) {
        logger.error('Error handling inbound status:', error);
        reply.status(500).send('Internal Server Error');
    }
};

export const handleWebSocket = (connection, request) => {
  const ws = connection.socket ? connection.socket : connection;
  logger.info('New WebSocket connection');

  let callSid = 'unknown';
  let callerId = 'unknown';
  let openAIService = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;
        callerId = data.start.customParameters?.callerId || 'unknown';

        openAIService = new OpenAIRealtimeService(ws, callSid, callerId);
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

    // Dynamically import markCallEnded to release the lock in dripService
    try {
        const { markCallEnded } = await import('../services/dripService.js');
        if (callSid !== 'unknown') {
            markCallEnded(callSid);
        }
    } catch (error) {
        logger.error('Error resolving drip lock on ws close:', error);
    }
  });
};
