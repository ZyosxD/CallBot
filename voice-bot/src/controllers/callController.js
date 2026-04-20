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

    // Pass callerId and mode (inbound) via parameters
    const callerId = request.body?.From || 'unknown';
    const stream = connect.stream({
      url: `wss://${request.headers.host}/voice/stream`,
    });
    stream.parameter({ name: 'callerId', value: callerId });
    stream.parameter({ name: 'mode', value: 'inbound' });

    reply.type('text/xml').send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const inboundStatus = async (request, reply) => {
  try {
    const { CallSid, CallStatus } = request.body;
    logger.info(`Call ${CallSid} status changed to ${CallStatus}`);

    if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(CallStatus.toLowerCase())) {
        const { markCallEnded } = await import('../services/dripService.js');
        markCallEnded(CallSid);
    }

    reply.code(200).send('OK');
  } catch (error) {
    logger.error('Error handling inbound status:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const handleWebSocket = (connection, req) => {
  logger.info('New WebSocket connection');

  // Safely extract the WebSocket instance based on Fastify v11
  const ws = connection.socket ? connection.socket : connection;

  let callSid = 'unknown';
  let callerId = 'unknown';
  let mode = 'inbound';

  const openAIService = new OpenAIRealtimeService(ws, callSid, callerId, mode);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());

      if (data.event === 'start') {
        callSid = data.start.callSid;

        // Extract parameters passed from TwiML
        const customParams = data.start.customParameters || {};
        callerId = customParams.callerId || 'unknown';
        mode = customParams.mode || 'inbound';

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
    logger.info('WebSocket connection closed');
    if (openAIService.openaiWs) {
        openAIService.openaiWs.close();
    }
    const { markCallEnded } = await import('../services/dripService.js');
    markCallEnded(callSid);
  });
};
