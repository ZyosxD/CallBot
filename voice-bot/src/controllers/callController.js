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

    const isOutboundApi = request.body?.Direction === 'outbound-api';
    const callerId = isOutboundApi ? request.body?.To : request.body?.From;
    const mode = isOutboundApi ? 'outbound' : 'inbound';

    const stream = connect.stream({
      url: `wss://${request.headers.host}/voice/stream`,
    });

    stream.parameter({
        name: 'callerId',
        value: callerId || 'unknown'
    });

    stream.parameter({
        name: 'mode',
        value: mode
    });

    reply.type('text/xml');
    return reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    return reply.code(500).send('Internal Server Error');
  }
};

export const inboundStatus = async (request, reply) => {
    try {
        const callSid = request.body?.CallSid;
        const callStatus = request.body?.CallStatus;

        logger.info(`Call status update received: ${callSid} is ${callStatus}`);

        if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(callStatus)) {
            const { markCallEnded } = await import('../services/dripService.js');
            markCallEnded(callSid);
        }

        return reply.code(200).send('OK');
    } catch (error) {
        logger.error('Error handling call status:', error);
        return reply.code(500).send('Internal Server Error');
    }
};

export const handleWebSocket = (connection, request) => {
  logger.info('New WebSocket connection');

  const ws = connection.socket ? connection.socket : connection;

  let callSid = 'unknown';

  const openAIService = new OpenAIRealtimeService(ws, callSid);
  openAIService.connect();

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;
        openAIService.callSid = callSid;

        const customParams = data.start.customParameters || {};
        openAIService.twilioCallerId = customParams.callerId || 'unknown';
        openAIService.callMode = customParams.mode || 'unknown';

        openAIService.handleTwilioMedia(data);
      } else if (data.event === 'media') {
        openAIService.handleTwilioMedia(data);
      } else if (data.event === 'stop') {
        logger.info(`Stream stopped for call ${callSid}`);
        const { markCallEnded } = await import('../services/dripService.js');
        markCallEnded(callSid);
        ws.close();
      }
    } catch (error) {
      logger.error('Error processing WebSocket message:', error);
    }
  });

  ws.on('close', async () => {
    logger.info('WebSocket connection closed');
    if (callSid !== 'unknown') {
        const { markCallEnded } = await import('../services/dripService.js');
        markCallEnded(callSid);
    }
    if (openAIService.openaiWs) {
        openAIService.openaiWs.close();
    }
  });
};
