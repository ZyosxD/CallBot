import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = async (req, reply) => {
  try {
    logger.info('Incoming call received');
    const callerId = (req.body && req.body.From) ? req.body.From : 'unknown';

    const response = new VoiceResponse();
    const connect = response.connect();
    connect.stream({
      url: `wss://${req.headers.host}/voice/stream?mode=inbound&callerId=${encodeURIComponent(callerId)}`,
    });

    reply.type('text/xml');
    return reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    return reply.code(500).send('Internal Server Error');
  }
};

export const inboundStatus = async (req, reply) => {
  try {
    const callSid = req.body && req.body.CallSid;
    const callStatus = req.body && req.body.CallStatus;

    logger.info(`Call ${callSid} status updated to: ${callStatus}`);

    // Release outbound lock if call is finished
    if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(callStatus)) {
      const { markCallEnded } = await import('../services/dripService.js');
      markCallEnded(callSid);
    }

    return reply.send('OK');
  } catch (error) {
    logger.error('Error handling inbound status:', error);
    return reply.code(500).send('Internal Server Error');
  }
};

export const handleWebSocket = (connection, req) => {
  logger.info('New WebSocket connection');

  const ws = connection.socket ? connection.socket : connection;

  const query = req.query || {};
  const mode = query.mode || 'inbound';
  const callerId = query.callerId || 'unknown';

  let callSid = 'unknown';

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

    // Fallback to release lock
    if (callSid !== 'unknown') {
      try {
        const { markCallEnded } = await import('../services/dripService.js');
        markCallEnded(callSid);
      } catch (e) {
        logger.error('Failed to import dripService on close', e);
      }
    }
  });
};
