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

    const callerId = request.query?.callerId || request.body?.From || 'unknown';
    const streamUrl = `wss://${request.headers.host}/voice/stream?mode=inbound&callerId=${encodeURIComponent(callerId)}`;

    connect.stream({
      url: streamUrl,
    });

    reply.type('text/xml');
    reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const inboundStatus = async (request, reply) => {
    try {
        const { CallSid, CallStatus } = request.body;
        logger.info(`Call Status Callback: SID ${CallSid}, Status: ${CallStatus}`);

        if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(CallStatus)) {
             const dripService = await import('../services/dripService.js');
             dripService.markCallEnded(CallSid);
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

  const urlParams = new URL(req.url, `http://${req.headers.host}`).searchParams;
  const mode = urlParams.get('mode') || 'inbound';
  const callerId = urlParams.get('callerId') || 'unknown';

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
    logger.info('WebSocket connection closed');
    if (openAIService.openaiWs) {
        openAIService.openaiWs.close();
    }
    const dripService = await import('../services/dripService.js');
    dripService.markCallEnded(callSid);
  });
};
