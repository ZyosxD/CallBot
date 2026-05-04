import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = (request, reply) => {
  try {
    logger.info('Call route accessed (inbound or outbound context)');
    const response = new VoiceResponse();
    const connect = response.connect();

    // Dynamically construct WebSocket URL relative to the fastify route prefix
    const wssUrl = `wss://${request.headers.host}/voice/stream`;

    const stream = connect.stream({
      url: wssUrl,
    });

    // Detect outbound vs inbound
    const isOutbound = request.body?.Direction === 'outbound-api';
    const callerId = isOutbound ? request.body?.To : request.body?.From;
    const mode = isOutbound ? 'outbound' : 'inbound';

    stream.parameter({ name: 'callerId', value: callerId || 'unknown' });
    stream.parameter({ name: 'mode', value: mode });

    reply.type('text/xml');
    reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling call XML:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const inboundStatus = async (request, reply) => {
    try {
        const callStatus = request.body?.CallStatus;
        const callSid = request.body?.CallSid;

        logger.info(`Status callback received. CallSid: ${callSid}, Status: ${callStatus}`);

        if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(callStatus)) {
            // Dynamically import to resolve circular dependencies and mark call ended
            const dripService = await import('../services/dripService.js');
            dripService.markCallEnded(callSid);
        }

        reply.send('OK');
    } catch (error) {
        logger.error('Error handling inbound status:', error);
        reply.status(500).send('Internal Server Error');
    }
};

export const handleWebSocket = (connection, request) => {
  logger.info('New WebSocket connection');

  // Safely extract the websocket based on the @fastify/websocket version
  const ws = connection.socket ? connection.socket : connection;

  let callSid = 'unknown';

  const openAIService = new OpenAIRealtimeService(ws, callSid);
  openAIService.connect();

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;
        openAIService.callSid = callSid;

        // Parse custom parameters from TwiML <Stream>
        const customParams = data.start.customParameters || {};
        openAIService.callerId = customParams.callerId || 'unknown';
        openAIService.mode = customParams.mode || 'inbound';

        logger.info(`Twilio Stream started. CallSid: ${callSid}, Mode: ${openAIService.mode}, CallerId: ${openAIService.callerId}`);
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
    logger.info(`WebSocket connection closed for CallSid: ${callSid}`);
    if (openAIService.openaiWs) {
        openAIService.openaiWs.close();
    }

    // Release concurrency lock in smart drip
    try {
        const dripService = await import('../services/dripService.js');
        dripService.markCallEnded(callSid);
    } catch (error) {
        logger.error('Error marking call ended on ws close:', error);
    }
  });
};
