import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = (request, reply) => {
  try {
    logger.info('Call received');
    const response = new VoiceResponse();
    const connect = response.connect();

    const stream = connect.stream({
      url: `wss://${request.headers.host}/voice/stream`,
    });

    const isOutbound = request.body?.Direction === 'outbound-api';
    const callerId = isOutbound ? request.body?.To : request.body?.From;
    const mode = isOutbound ? 'outbound' : 'inbound';

    stream.parameter({ name: 'callerId', value: callerId || 'unknown' });
    stream.parameter({ name: 'mode', value: mode });

    reply.type('text/xml');
    reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const inboundStatus = async (request, reply) => {
    try {
        const callStatus = request.body?.CallStatus;
        const callSid = request.body?.CallSid;
        logger.info(`Call Status Update: ${callSid} is ${callStatus}`);

        if (['completed', 'failed', 'busy', 'no-answer', 'canceled'].includes(callStatus)) {
             // Dynamic import to avoid circular dependency
             const { markCallEnded } = await import('../services/dripService.js');
             markCallEnded(callSid);
        }
        reply.send('OK');
    } catch (error) {
        logger.error('Error handling inbound status:', error);
        reply.status(500).send('Internal Server Error');
    }
}

export const handleWebSocket = (connection, req) => {
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
        // The parameters from TwiML stream can be extracted here
        const customParams = data.start.customParameters || {};
        openAIService.callerId = customParams.callerId || 'unknown';
        openAIService.mode = customParams.mode || 'unknown';

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
    const { markCallEnded } = await import('../services/dripService.js');
    markCallEnded(callSid);
  });
};
