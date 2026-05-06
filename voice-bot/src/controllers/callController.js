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

    const isOutbound = request.body?.Direction === 'outbound-api';
    const callerId = isOutbound ? request.body?.To : request.body?.From;
    const mode = isOutbound ? 'outbound' : 'inbound';

    const stream = connect.stream({
      url: `wss://${request.headers.host}/voice/stream`,
    });

    stream.parameter({ name: 'callerId', value: callerId || 'unknown' });
    stream.parameter({ name: 'mode', value: mode });

    reply.type('text/xml');
    return reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    return reply.status(500).send('Internal Server Error');
  }
};

export const inboundStatus = async (request, reply) => {
  try {
    const callStatus = request.body?.CallStatus;
    const callSid = request.body?.CallSid;

    logger.info(`Call status update received: ${callSid} - ${callStatus}`);

    if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(callStatus)) {
      const dripService = await import('../services/dripService.js');
      dripService.markCallEnded(callSid);
    }

    return reply.status(200).send();
  } catch (error) {
    logger.error('Error handling inbound status:', error);
    return reply.status(500).send('Internal Server Error');
  }
};

export const handleWebSocket = (connection, request) => {
  logger.info('New WebSocket connection');
  const ws = connection.socket ? connection.socket : connection;
  let callSid = 'unknown';

  const openAIService = new OpenAIRealtimeService(ws, callSid);
  openAIService.connect();

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;
        openAIService.callSid = callSid;
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

    try {
      const dripService = await import('../services/dripService.js');
      dripService.markCallEnded(callSid);
    } catch (err) {
      logger.error('Error marking call ended on ws close:', err);
    }
  });
};
