import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = async (req, reply) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();

    // Construct absolute wss url based on the request host
    const stream = connect.stream({
      url: `wss://${req.headers.host}/voice/stream`,
    });

    // Pass custom parameters to identify the call as inbound and store caller info
    stream.parameter({ name: 'mode', value: 'inbound' });
    const callerId = req.body?.From || 'unknown';
    stream.parameter({ name: 'callerId', value: callerId });

    reply.type('text/xml').send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.code(500).send('Internal Server Error');
  }
};

export const callStatus = async (req, reply) => {
  try {
    const { CallSid, CallStatus } = req.body;
    logger.info(`Call ${CallSid} status update: ${CallStatus}`);

    // If the call reached a terminal state, release the Smart Drip dialing lock
    if (['completed', 'failed', 'busy', 'no-answer', 'canceled'].includes(CallStatus.toLowerCase())) {
      const { markCallEnded } = await import('../services/dripService.js');
      markCallEnded(CallSid);
    }

    reply.send('OK');
  } catch (error) {
    logger.error('Error handling call status update:', error);
    reply.code(500).send('Internal Server Error');
  }
};

export const handleWebSocket = (ws, req) => {
  logger.info('New WebSocket connection');

  let callSid = 'unknown';
  let openAIService = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;
        const customParams = data.start.customParameters || {};
        const mode = customParams.mode || 'inbound';
        const callerId = customParams.callerId || 'unknown';

        openAIService = new OpenAIRealtimeService(ws, callSid, callerId, mode);
        openAIService.connect();
        openAIService.handleTwilioMedia(data);
      } else if (data.event === 'media') {
        if (openAIService) openAIService.handleTwilioMedia(data);
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

    // Forcefully release the drip dialing lock to prevent deadlocks
    try {
      const { markCallEnded } = await import('../services/dripService.js');
      markCallEnded(callSid);
    } catch (err) {
      logger.error('Error importing markCallEnded on ws close:', err);
    }
  });
};
