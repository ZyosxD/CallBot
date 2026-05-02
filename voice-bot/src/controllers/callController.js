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
    const stream = connect.stream({
      url: `wss://${request.headers.host}/voice/stream`,
    });

    const isOutbound = request.body?.Direction === 'outbound-api';
    const mode = isOutbound ? 'outbound' : 'inbound';
    const callerId = isOutbound ? request.body?.To : request.body?.From;

    stream.parameter({ name: 'mode', value: mode });
    stream.parameter({ name: 'callerId', value: callerId || 'unknown' });

    reply.type('text/xml');
    return reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    return reply.status(500).send('Internal Server Error');
  }
};

export const inboundStatus = async (request, reply) => {
  try {
    const callSid = request.body?.CallSid;
    const callStatus = request.body?.CallStatus;

    if (callSid && ['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(callStatus)) {
      logger.info(`Call ${callSid} ended with status: ${callStatus}`);
      const { markCallEnded } = await import('../services/dripService.js');
      markCallEnded(callSid);
    }
    return reply.send({ status: 'ok' });
  } catch (error) {
    logger.error('Error handling inbound status:', error);
    return reply.status(500).send('Internal Server Error');
  }
};

export const handleWebSocket = (connection, request) => {
  logger.info('New WebSocket connection');

  const ws = connection.socket ? connection.socket : connection;

  let callSid = 'unknown';
  let callerId = 'unknown';
  let mode = 'inbound';

  const openAIService = new OpenAIRealtimeService(ws, callSid);
  openAIService.connect();

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;
        openAIService.callSid = callSid;

        // Extract parameters
        if (data.start.customParameters) {
          callerId = data.start.customParameters.callerId || 'unknown';
          mode = data.start.customParameters.mode || 'inbound';
        }
        openAIService.callerId = callerId;
        openAIService.mode = mode;

        logger.info(`Stream started for call ${callSid} (Mode: ${mode}, CallerID: ${callerId})`);

        openAIService.isTwilioStarted = true;
        openAIService.handleTwilioMedia(data);
        openAIService.checkAndInitializeSession();
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

    // Release concurrency lock
    if (callSid !== 'unknown') {
        const { markCallEnded } = await import('../services/dripService.js');
        markCallEnded(callSid);
    }
  });
};
