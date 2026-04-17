import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = async (request, reply) => {
  try {
    logger.info('Incoming call received');
    const callerId = request.body?.From || 'unknown';

    const response = new VoiceResponse();
    const connect = response.connect();

    const stream = connect.stream({
      url: `wss://${request.headers.host}/voice/stream`,
    });

    stream.parameter({ name: 'mode', value: 'inbound' });
    stream.parameter({ name: 'callerId', value: callerId });

    reply.type('text/xml').send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const inboundStatus = async (request, reply) => {
  const callSid = request.body?.CallSid;
  const callStatus = request.body?.CallStatus;

  logger.info(`Inbound Call ${callSid} status changed to ${callStatus}`);

  if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(callStatus)) {
    try {
      const dripService = await import('../services/dripService.js');
      dripService.markCallEnded(callSid);
    } catch (e) {
      logger.error('Failed to dynamic import dripService to mark call ended', e);
    }
  }

  reply.send({ received: true });
};

export const outboundStatus = async (request, reply) => {
  const callSid = request.body?.CallSid;
  const callStatus = request.body?.CallStatus;

  logger.info(`Outbound Call ${callSid} status changed to ${callStatus}`);

  if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(callStatus)) {
    try {
      const dripService = await import('../services/dripService.js');
      dripService.markCallEnded(callSid);
    } catch (e) {
      logger.error('Failed to dynamic import dripService to mark outbound call ended', e);
    }
  }

  reply.send({ received: true });
};

export const handleWebSocketStream = (connection, request) => {
  logger.info('New WebSocket connection via Fastify');
  // Handle Fastify v11 WebSocket object differences
  const ws = connection.socket ? connection.socket : connection;

  let callSid = 'unknown';
  let mode = 'inbound';
  let callerId = 'unknown';

  let openAIService = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;
        mode = data.start.customParameters?.mode || 'inbound';
        callerId = data.start.customParameters?.callerId || 'unknown';

        openAIService = new OpenAIRealtimeService(ws, callSid, mode, callerId);
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
    logger.info(`WebSocket connection closed for callSid: ${callSid}`);
    if (openAIService && openAIService.openaiWs) {
        openAIService.openaiWs.close();
    }

    // Dynamically import markCallEnded to release lock just in case the status webhook misses
    if (callSid !== 'unknown') {
      try {
        const dripService = await import('../services/dripService.js');
        dripService.markCallEnded(callSid);
      } catch (e) {
        logger.error('Failed to dynamic import dripService on ws close', e);
      }
    }
  });
};