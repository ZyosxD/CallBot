import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundStatus = async (request, reply) => {
  try {
    const status = request.body.CallStatus;
    const callSid = request.body.CallSid;

    if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(status)) {
        const { markCallEnded } = await import('../services/dripService.js');
        markCallEnded(callSid);
    }
    reply.send('OK');
  } catch (error) {
    logger.error('Error handling inbound status:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const inboundCall = async (request, reply) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();

    // Determine host for websocket url
    const host = request.headers.host;
    // Extract mode and callerId for memory rules
    const mode = (request.query && request.query.mode) ? request.query.mode : 'inbound';
    const callerId = request.query?.callerId || request.body?.From || 'unknown';

    const stream = connect.stream({
      url: `wss://${host}/voice/stream`,
    });

    stream.parameter({ name: 'mode', value: mode });
    stream.parameter({ name: 'callerId', value: callerId });

    reply.type('text/xml').send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const handleWebSocket = (connection, request) => {
  logger.info('New WebSocket connection');

  const ws = connection.socket ? connection.socket : connection;

  let callSid = 'unknown';
  let mode = 'inbound';
  let callerId = 'unknown';

  const openAIService = new OpenAIRealtimeService(ws, callSid);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;
        openAIService.callSid = callSid;

        // Extract parameters injected by TwiML
        if (data.start.customParameters) {
            if (data.start.customParameters.mode) {
                mode = data.start.customParameters.mode;
                openAIService.mode = mode;
            }
            if (data.start.customParameters.callerId) {
                callerId = data.start.customParameters.callerId;
                openAIService.callerId = callerId;
            }
        }

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
    // Dynamic import to break circular dependency
    try {
        const { markCallEnded } = await import('../services/dripService.js');
        markCallEnded(callSid);
    } catch (error) {
        logger.error('Error calling markCallEnded on ws close', error);
    }
  });
};
