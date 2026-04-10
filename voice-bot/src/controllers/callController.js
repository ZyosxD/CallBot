import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = (request, reply) => {
  try {
    const callerId = request.query?.callerId || request.body?.From || 'unknown';
    logger.info(`Incoming call received from ${callerId}`);
    const response = new VoiceResponse();
    const connect = response.connect();

    // Inbound mode
    const streamUrl = `wss://${request.headers.host}/voice/stream?mode=inbound&callerId=${encodeURIComponent(callerId)}`;
    const stream = connect.stream({ url: streamUrl });

    reply.type('text/xml');
    return reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    return reply.status(500).send('Internal Server Error');
  }
};

export const outboundCall = (request, reply) => {
  try {
    const callerId = request.query?.callerId || request.body?.To || 'unknown';
    logger.info(`Outbound call connecting to ${callerId}`);
    const response = new VoiceResponse();
    const connect = response.connect();

    // Outbound mode
    const streamUrl = `wss://${request.headers.host}/voice/stream?mode=outbound&callerId=${encodeURIComponent(callerId)}`;
    const stream = connect.stream({ url: streamUrl });

    reply.type('text/xml');
    return reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling outbound call:', error);
    return reply.status(500).send('Internal Server Error');
  }
};

export const inboundStatus = async (request, reply) => {
  const callStatus = request.body?.CallStatus;
  const callSid = request.body?.CallSid;

  logger.info(`Call status update: ${callSid} is ${callStatus}`);

  if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(callStatus)) {
    try {
      const { markCallEnded } = await import('../services/dripService.js');
      markCallEnded(callSid);
    } catch (err) {
      logger.error('Error importing or calling markCallEnded:', err);
    }
  }

  return reply.status(200).send('OK');
};

export const handleWebSocket = (ws, req) => {
  logger.info('New WebSocket connection');

  let callSid = 'unknown';

  // Extract parameters from URL query
  const urlParams = new URLSearchParams(req.url.split('?')[1]);
  const mode = urlParams.get('mode') || 'inbound';
  const callerId = urlParams.get('callerId') || 'unknown';

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

    // Ensure lock is released on disconnect
    try {
      if (callSid !== 'unknown') {
        const { markCallEnded } = await import('../services/dripService.js');
        markCallEnded(callSid);
      }
    } catch (err) {
      logger.error('Error importing or calling markCallEnded on ws close:', err);
    }
  });
};
