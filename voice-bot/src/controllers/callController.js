import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = async (request, reply) => {
  try {
    logger.info('Incoming call received');
    const callerId = request.body?.From || 'unknown';

    const response = new VoiceResponse();
    const connect = response.connect();
    const stream = connect.stream({
      url: `wss://${request.headers.host}/voice/stream`,
    });

    stream.parameter({ name: 'callerId', value: callerId });
    stream.parameter({ name: 'mode', value: 'inbound' });

    reply.type('text/xml');
    reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const inboundStatus = async (request, reply) => {
  try {
    const callStatus = request.body?.CallStatus;
    const callSid = request.body?.CallSid;

    logger.info(`Call status update received: ${callSid} is ${callStatus}`);

    if (callStatus === 'completed' || callStatus === 'busy' || callStatus === 'failed' || callStatus === 'no-answer' || callStatus === 'canceled') {
      const { markCallEnded } = await import('../services/dripService.js');
      markCallEnded(callSid);
    }

    reply.status(200).send('OK');
  } catch (error) {
    logger.error('Error handling inbound status:', error);
    reply.status(500).send('Internal Server Error');
  }
}

export const handleWebSocket = (connection, request) => {
  logger.info('New WebSocket connection');

  const ws = connection.socket ? connection.socket : connection;

  let callSid = 'unknown';
  let callerId = 'unknown';
  let mode = 'inbound';

  const openAIService = new OpenAIRealtimeService(ws, callSid, callerId, mode);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;
        callerId = data.start.customParameters?.callerId || 'unknown';
        mode = data.start.customParameters?.mode || 'inbound';

        openAIService.callSid = callSid;
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
    logger.info(`WebSocket connection closed for callSid ${callSid}`);
    if (openAIService.openaiWs) {
        openAIService.openaiWs.close();
    }
    if (callSid !== 'unknown') {
      const { markCallEnded } = await import('../services/dripService.js');
      markCallEnded(callSid);
    }
  });
};
