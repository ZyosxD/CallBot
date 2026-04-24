import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';

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

    return reply.type('text/xml').send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    return reply.code(500).send('Internal Server Error');
  }
};

export const inboundStatus = async (request, reply) => {
    try {
        const { CallSid, CallStatus } = request.body || {};
        logger.info(`Status callback received. CallSid: ${CallSid}, Status: ${CallStatus}`);

        if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(CallStatus)) {
            const { markCallEnded } = await import('../services/dripService.js');
            markCallEnded(CallSid);
        }
        return reply.code(200).send('OK');
    } catch (error) {
        logger.error('Error handling status callback:', error);
        return reply.code(500).send('Internal Server Error');
    }
};

export const handleWebSocket = (ws, request) => {
  logger.info('New WebSocket connection');

  let callSid = 'unknown';
  let callerId = 'unknown';
  let mode = 'inbound';
  let openAIService = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;

        // Extract parameters from stream start
        const customParameters = data.start.customParameters || {};
        callerId = customParameters.callerId || 'unknown';
        mode = customParameters.mode || 'inbound';

        openAIService = new OpenAIRealtimeService(ws, callSid, callerId, mode);
        openAIService.connect();

        openAIService.handleTwilioMedia(data);
      } else if (data.event === 'media') {
        if (openAIService) {
            openAIService.handleTwilioMedia(data);
        }
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

    // Safety net: always ensure the outbound lock is released if WS dies unexpectedly
    try {
        const { markCallEnded } = await import('../services/dripService.js');
        markCallEnded(callSid);
    } catch (e) {
        logger.error('Error executing markCallEnded on ws close', e);
    }
  });
};
