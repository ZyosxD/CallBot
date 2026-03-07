import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';
import { releaseCallLock } from '../services/dripService.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = async (request, reply) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();

    const callerId = request.body?.From || 'unknown';

    const stream = connect.stream({
      url: `wss://${request.headers.host}/voice/stream`,
    });

    stream.parameter({
      name: 'callerId',
      value: callerId
    });
    stream.parameter({
      name: 'mode',
      value: 'inbound'
    });

    reply.type('text/xml');
    return reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const outboundTwiml = async (request, reply) => {
  try {
    logger.info('Generating outbound TwiML');
    const response = new VoiceResponse();
    const connect = response.connect();

    const callerId = request.query?.callerId || 'unknown';
    const mode = request.query?.mode || 'outbound';

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
    logger.error('Error generating outbound TwiML:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const statusCallback = async (request, reply) => {
  const callStatus = request.body?.CallStatus;
  logger.info(`Call status update: ${callStatus}`);

  if (['completed', 'failed', 'busy', 'no-answer', 'canceled'].includes(callStatus)) {
      releaseCallLock();
  }
  return reply.send('OK');
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
        const callerId = customParams.callerId || 'unknown';
        const mode = customParams.mode || 'inbound';

        openAIService = new OpenAIRealtimeService(ws, callSid, callerId, mode);
        openAIService.connect();

        openAIService.handleTwilioMedia(data);
      } else if (data.event === 'media') {
        if (openAIService) {
          openAIService.handleTwilioMedia(data);
        }
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
    if (openAIService && openAIService.openaiWs) {
        openAIService.openaiWs.close();
    }
  });
};
