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

    // For outbound calls initiated via REST API, Direction will be 'outbound-api'
    const isOutbound = request.body?.Direction === 'outbound-api';
    const callerId = isOutbound ? (request.body?.To || 'unknown') : (request.body?.From || 'unknown');
    const mode = isOutbound ? 'outbound' : 'inbound';

    const stream = connect.stream({
      url: `wss://${request.headers.host}/voice/stream`,
    });

    stream.parameter({
      name: 'callerId',
      value: callerId
    });

    stream.parameter({
      name: 'mode',
      value: mode
    });

    reply.type('text/xml');
    return reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    return reply.status(500).send('Internal Server Error');
  }
};

export const inboundStatus = async (request, reply) => {
  try {
    const status = request.body?.CallStatus;
    const callSid = request.body?.CallSid;

    logger.info(`Call Status Update - Sid: ${callSid}, Status: ${status}`);

    if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(status)) {
      const { markCallEnded } = await import('../services/dripService.js');
      markCallEnded(callSid);
    }

    return reply.send('OK');
  } catch (error) {
    logger.error('Error handling inbound status:', error);
    return reply.status(500).send('Internal Server Error');
  }
};

export const handleWebSocket = (ws, req) => {
  logger.info('New WebSocket connection');

  let callSid = 'unknown';
  let callerId = 'unknown';
  let mode = 'inbound';

  const openAIService = new OpenAIRealtimeService(ws, callSid);

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;
        openAIService.callSid = callSid;

        if (data.start.customParameters) {
          callerId = data.start.customParameters.callerId || 'unknown';
          mode = data.start.customParameters.mode || 'inbound';
        }

        openAIService.callerId = callerId;
        openAIService.mode = mode;

        logger.info(`Twilio Stream started. CallSid: ${callSid}, CallerId: ${callerId}, Mode: ${mode}`);

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
    if (openAIService.openaiWs && openAIService.openaiWs.readyState === ws.OPEN) {
        openAIService.openaiWs.close();
    }

    if (callSid !== 'unknown') {
      const { markCallEnded } = await import('../services/dripService.js');
      markCallEnded(callSid);
    }
  });

  openAIService.connect();
};
