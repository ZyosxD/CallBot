import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = async (req, reply) => {
  try {
    logger.info('Incoming call received');
    const mode = req.query.mode || 'inbound';
    // For inbound, extract callerId from Twilio request body (From),
    // for outbound, it should be in the query parameters from initiateCall
    const callerId = req.query.callerId || req.body?.From || 'unknown';

    const response = new VoiceResponse();
    const connect = response.connect();
    const stream = connect.stream({
      url: `wss://${req.headers.host}/voice/stream`,
    });

    stream.parameter({ name: 'callerId', value: callerId });
    stream.parameter({ name: 'mode', value: mode });

    reply.type('text/xml');
    return reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    return reply.code(500).send('Internal Server Error');
  }
};

export const inboundStatus = async (req, reply) => {
  const callSid = req.body?.CallSid;
  const status = req.body?.CallStatus;

  logger.info(`Call status update received: ${callSid} - ${status}`);

  if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(status)) {
    try {
      const dripService = await import('../services/dripService.js');
      dripService.markCallEnded(callSid);
    } catch (err) {
      logger.error('Error unlocking drip service via status:', err);
    }
  }

  return reply.send('OK');
};

export const handleWebSocket = (ws, req) => {
  logger.info('New WebSocket connection');

  let callSid = 'unknown';
  let callerId = 'unknown';
  let mode = 'inbound';

  const openAIService = new OpenAIRealtimeService(ws, callSid);
  openAIService.connect();

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;

        // Extract custom parameters
        const customParams = data.start.customParameters || {};
        callerId = customParams.callerId || 'unknown';
        mode = customParams.mode || 'inbound';

        logger.info(`Stream started for CallSid: ${callSid}, CallerId: ${callerId}, Mode: ${mode}`);

        openAIService.callSid = callSid;
        openAIService.callerId = callerId;
        openAIService.mode = mode;
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
    logger.info(`WebSocket connection closed for CallSid: ${callSid}`);
    if (openAIService.openaiWs) {
        openAIService.openaiWs.close();
    }

    try {
      const dripService = await import('../services/dripService.js');
      dripService.markCallEnded(callSid);
    } catch (err) {
      logger.error('Error unlocking drip service on close:', err);
    }
  });
};
