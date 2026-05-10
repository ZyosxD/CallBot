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

    // Dynamically detect if outbound
    const isOutbound = request.body?.Direction === 'outbound-api';
    const callerId = isOutbound ? request.body?.To : request.body?.From;
    const mode = isOutbound ? 'outbound' : 'inbound';

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

export const outboundCall = (request, reply) => {
  try {
    logger.info('Outbound call webhook received');
    const response = new VoiceResponse();
    const connect = response.connect();

    const callerId = request.query.callerId || request.body?.To;

    const stream = connect.stream({
      url: `wss://${request.headers.host}/voice/stream`,
    });

    stream.parameter({
      name: 'callerId',
      value: callerId || 'unknown'
    });

    stream.parameter({
      name: 'mode',
      value: 'outbound'
    });

    reply.type('text/xml');
    return reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling outbound call:', error);
    return reply.code(500).send('Internal Server Error');
  }
};

export const outboundStatus = async (request, reply) => {
  try {
    const callStatus = request.body?.CallStatus;
    const callSid = request.body?.CallSid;

    logger.info(`Outbound status webhook: CallSid=${callSid}, Status=${callStatus}`);

    if (callStatus === 'completed' || callStatus === 'failed' || callStatus === 'busy' || callStatus === 'no-answer' || callStatus === 'canceled') {
      const { releaseCallLock } = await import('../services/dripService.js');
      releaseCallLock(callSid);
    }

    return reply.send('OK');
  } catch (error) {
    logger.error('Error handling outbound status:', error);
    return reply.code(500).send('Internal Server Error');
  }
};

export const handleWebSocket = (connection, req) => {
  logger.info('New WebSocket connection');

  const ws = connection.socket ? connection.socket : connection;

  let callSid = 'unknown';
  let callerId = 'unknown';
  let mode = 'inbound'; // default

  const openAIService = new OpenAIRealtimeService(ws, callSid);
  openAIService.connect();

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;
        openAIService.callSid = callSid;

        // Extract parameters
        if (data.start.customParameters) {
          callerId = data.start.customParameters.callerId || callerId;
          mode = data.start.customParameters.mode || mode;
        }

        openAIService.callerId = callerId;
        openAIService.mode = mode;

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

    try {
      const { releaseCallLock } = await import('../services/dripService.js');
      releaseCallLock(callSid);
    } catch (e) {
      logger.error('Error releasing lock on socket close:', e);
    }
  });
};
