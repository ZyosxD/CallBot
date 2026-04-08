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

    // Inject mode=inbound
    const callerId = request.body?.From || 'unknown';

    connect.stream({
      url: `wss://${request.headers.host}/voice/stream?mode=inbound&callerId=${encodeURIComponent(callerId)}`,
    });

    reply.type('text/xml').send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const inboundStatus = async (request, reply) => {
  const callStatus = request.body?.CallStatus;
  const callSid = request.body?.CallSid;

  logger.info(`Status callback received: ${callStatus} for CallSid: ${callSid}`);

  if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(callStatus)) {
    try {
      const { markCallEnded } = await import('../services/dripService.js');
      markCallEnded(callSid);
    } catch (e) {
      logger.error('Error importing dripService for markCallEnded', e);
    }
  }

  reply.send('OK');
};

export const handleWebSocket = (ws, request) => {
  logger.info('New WebSocket connection');

  let callSid = 'unknown';
  const mode = request.query?.mode || 'inbound';
  const callerId = request.query?.callerId || 'unknown';

  const openAIService = new OpenAIRealtimeService(ws, callSid, mode, callerId);
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

    // Forcefully release lock if it disconnects abruptly
    try {
      const { markCallEnded } = await import('../services/dripService.js');
      markCallEnded(callSid);
    } catch (e) {
      logger.error('Error importing dripService for markCallEnded on ws close', e);
    }
  });
};
