import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';
import { callEnded } from '../services/dripService.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = (request, reply) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();

    // Determine direction and clientId if present (for outbound initiated by us)
    // For pure inbound, direction is 'inbound' by default
    const direction = request.query.direction || 'inbound';
    const clientId = request.query.clientId || '';
    const phone = request.query.phone || '';

    const stream = connect.stream({
      url: `wss://${request.headers.host}/voice/stream?direction=${direction}&clientId=${clientId}&phone=${encodeURIComponent(phone)}`,
    });

    reply.type('text/xml');
    reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const handleStatusCallback = (request, reply) => {
  const callStatus = request.body.CallStatus;
  const callSid = request.body.CallSid;

  logger.info(`Call Status Update: ${callSid} -> ${callStatus}`);

  if (['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(callStatus)) {
    callEnded();
  }

  reply.send('OK');
};

export const handleWebSocket = (ws, req) => {
  logger.info('New WebSocket connection');

  // Extract query params from req.url
  const url = new URL(req.url, `http://${req.headers.host}`);
  const direction = url.searchParams.get('direction') || 'inbound';
  const clientId = url.searchParams.get('clientId');
  const phone = url.searchParams.get('phone');

  let callSid = 'unknown';

  const openAIService = new OpenAIRealtimeService(ws, callSid);
  openAIService.setContext(direction, clientId, phone);
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

  ws.on('close', () => {
    logger.info('WebSocket connection closed');
    if (openAIService.openaiWs) {
        openAIService.openaiWs.close();
    }
  });
};
