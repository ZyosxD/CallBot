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
    const stream = connect.stream({
      url: `wss://${request.headers.host}/voice/stream`,
    });

    const isOutbound = request.body?.Direction === 'outbound-api';
    const callerId = isOutbound ? request.body?.To : request.body?.From;
    const mode = isOutbound ? 'outbound' : 'inbound';

    stream.parameter({ name: 'callerId', value: callerId });
    stream.parameter({ name: 'mode', value: mode });

    reply.type('text/xml').send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const inboundStatus = (request, reply) => {
  try {
    const callSid = request.body?.CallSid;
    const callStatus = request.body?.CallStatus;

    logger.info(`Call status update for ${callSid}: ${callStatus}`);

    if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(callStatus)) {
        import('../services/dripService.js').then(({ markCallEnded }) => {
           markCallEnded(callSid);
        }).catch(err => logger.error('Error importing dripService:', err));
    }

    reply.send('OK');
  } catch (error) {
    logger.error('Error handling inbound status:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const handleWebSocket = (connection, req) => {
  logger.info('New WebSocket connection');

  const ws = connection.socket ? connection.socket : connection;

  let callSid = 'unknown';
  let callerId = 'unknown';

  const openAIService = new OpenAIRealtimeService(ws, callSid);
  openAIService.connect();

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;
        callerId = data.start.customParameters?.callerId || 'unknown';
        openAIService.callSid = callSid;
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

    if (callSid !== 'unknown') {
      import('../services/dripService.js').then(({ markCallEnded }) => {
         markCallEnded(callSid);
      }).catch(err => logger.error('Error importing dripService:', err));
    }
  });
};
