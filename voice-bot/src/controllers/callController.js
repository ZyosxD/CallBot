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

    // Inbound mode explicitly set, and caller ID taken from request body if available
    const callerId = request.body?.From || 'unknown';

    const stream = connect.stream({
      url: `wss://${request.headers.host}/voice/stream`,
    });

    stream.parameter({ name: 'callerId', value: callerId });
    stream.parameter({ name: 'mode', value: 'inbound' });

    reply.type('text/xml');
    reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const inboundStatus = async (request, reply) => {
  try {
    const { CallStatus, CallSid } = request.body;
    logger.info(`CallStatus updated: ${CallStatus} for CallSid: ${CallSid}`);

    // Terminal states where we should release the lock
    if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(CallStatus)) {
      const { markCallEnded } = await import('../services/dripService.js');
      markCallEnded(CallSid);
    }

    reply.send('OK');
  } catch (error) {
    logger.error('Error handling inbound status:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const handleWebSocket = (ws, req) => {
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
    logger.info(`WebSocket connection closed for call ${callSid}`);
    if (openAIService.openaiWs) {
        openAIService.openaiWs.close();
    }

    // Always attempt to release the lock on WS close
    if (callSid !== 'unknown') {
      try {
        const { markCallEnded } = await import('../services/dripService.js');
        markCallEnded(callSid);
      } catch (err) {
        logger.error('Error importing or calling markCallEnded:', err);
      }
    }
  });
};
