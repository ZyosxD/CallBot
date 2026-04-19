import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = (request, reply) => {
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

    return reply.type('text/xml').send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    return reply.code(500).send('Internal Server Error');
  }
};

export const inboundStatus = async (request, reply) => {
    try {
        const { CallSid, CallStatus } = request.body;
        logger.info(`Call ${CallSid} changed status to ${CallStatus}`);

        if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(CallStatus.toLowerCase())) {
            const { markCallEnded } = await import('../services/dripService.js');
            markCallEnded(CallSid);
        }

        return reply.code(200).send('OK');
    } catch (error) {
        logger.error('Error handling call status callback:', error);
        return reply.code(500).send('Internal Server Error');
    }
};

export const handleWebSocket = (connection, request) => {
  const ws = connection.socket ? connection.socket : connection;
  logger.info('New WebSocket connection');

  let callSid = 'unknown';
  let mode = 'inbound';
  let callerId = 'unknown';

  const openAIService = new OpenAIRealtimeService(ws, callSid);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;

        if (data.start.customParameters) {
            mode = data.start.customParameters.mode || 'inbound';
            callerId = data.start.customParameters.callerId || 'unknown';
        }

        openAIService.callSid = callSid;
        openAIService.mode = mode;
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

    // Ensure lock is released if WS closes unexpectedly
    if (callSid !== 'unknown') {
        try {
            const { markCallEnded } = await import('../services/dripService.js');
            markCallEnded(callSid);
        } catch (error) {
            logger.error('Error dynamically importing dripService:', error);
        }
    }
  });
};
