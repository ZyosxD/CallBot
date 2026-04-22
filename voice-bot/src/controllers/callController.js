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

    // Pass callerId and mode via stream parameters
    const stream = connect.stream({
      url: `wss://${request.headers.host}/voice/stream`,
    });

    // 'From' handles inbound callerId
    stream.parameter({
      name: 'callerId',
      value: request.body?.From || 'unknown'
    });

    stream.parameter({
      name: 'mode',
      value: 'inbound'
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
    const callSid = request.body?.CallSid;
    const callStatus = request.body?.CallStatus;
    logger.info(`Call status update received: ${callSid} - ${callStatus}`);

    // Release outbound locking dynamically when call disconnects
    if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(callStatus)) {
        const { markCallEnded } = await import('../services/dripService.js');
        markCallEnded(callSid);
    }

    reply.send('OK');
  } catch (error) {
    logger.error('Error handling inbound status:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const handleWebSocket = (ws, req) => {
  logger.info('New WebSocket connection');

  let callSid = 'unknown';
  let callerId = 'unknown';
  let mode = 'inbound';

  const openAIService = new OpenAIRealtimeService(ws, callSid);
  openAIService.connect();

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

        openAIService.handleTwilioStart();
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

    // Dynamically release drip lock on disconnect
    try {
      if (callSid !== 'unknown') {
        const { markCallEnded } = await import('../services/dripService.js');
        markCallEnded(callSid);
      }
    } catch (err) {
      logger.error('Error closing WebSocket lock release:', err);
    }
  });
};
