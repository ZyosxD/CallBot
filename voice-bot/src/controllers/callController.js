import twilio from 'twilio';
import logger from '../utils/logger.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = async (request, reply) => {
  try {
    const isOutbound = request.body?.Direction === 'outbound-api';
    const callerId = isOutbound ? request.body?.To : request.body?.From;
    const mode = isOutbound ? 'outbound' : 'inbound';
    const callSid = request.body?.CallSid || 'unknown';

    logger.info(`Call received. Sid: ${callSid}, Direction: ${request.body?.Direction}, Mode: ${mode}, CallerId: ${callerId}`);

    const response = new VoiceResponse();
    const connect = response.connect();
    const stream = connect.stream({
      url: `wss://${request.headers.host}/voice/stream`,
    });

    stream.parameter({ name: 'callerId', value: callerId });
    stream.parameter({ name: 'mode', value: mode });

    return reply.type('text/xml').send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    return reply.code(500).send('Internal Server Error');
  }
};

export const inboundStatus = async (request, reply) => {
  try {
    const callSid = request.body?.CallSid;
    const callStatus = request.body?.CallStatus;

    logger.info(`Status update for call ${callSid}: ${callStatus}`);

    if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(callStatus)) {
      // dynamically import markCallEnded to avoid circular dependency issues if any
      const { markCallEnded } = await import('../services/dripService.js');
      markCallEnded(callSid);
    }

    return reply.code(200).send('OK');
  } catch (error) {
    logger.error('Error handling status callback:', error);
    return reply.code(500).send('Internal Server Error');
  }
};

export const handleWebSocket = (connection, req) => {
  const ws = connection.socket ? connection.socket : connection;
  logger.info('New WebSocket connection');

  let callSid = 'unknown';

  import('../services/openaiRealtime.js').then(({ OpenAIRealtimeService }) => {
    const openAIService = new OpenAIRealtimeService(ws, callSid);
    openAIService.connect();

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());

        if (data.event === 'start') {
          callSid = data.start.callSid;
          openAIService.callSid = callSid;

          // Extract custom parameters
          const customParams = data.start.customParameters || {};
          const callerId = customParams.callerId || 'Unknown';
          const mode = customParams.mode || 'inbound';

          openAIService.callerId = callerId;
          openAIService.mode = mode;

          logger.info(`Stream started for callSid: ${callSid}, mode: ${mode}, callerId: ${callerId}`);

          openAIService.isTwilioStarted = true;
          openAIService.checkAndInitializeSession();
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
      logger.info(`WebSocket connection closed for callSid: ${callSid}`);
      if (openAIService.openaiWs) {
          openAIService.openaiWs.close();
      }
      const { markCallEnded } = await import('../services/dripService.js');
      markCallEnded(callSid);
    });
  }).catch(err => {
    logger.error('Error loading OpenAIRealtimeService', err);
  });
};
