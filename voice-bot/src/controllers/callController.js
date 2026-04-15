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

    // TwiML for incoming calls
    const stream = connect.stream({
      url: `wss://${request.headers.host}/voice/stream`,
    });

    // Pass parameters
    stream.parameter({ name: 'callerId', value: callerId });
    stream.parameter({ name: 'mode', value: 'inbound' });

    reply.type('text/xml');
    return reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    return reply.code(500).send('Internal Server Error');
  }
};

export const inboundStatus = async (request, reply) => {
  try {
    const status = request.body.CallStatus;
    const callSid = request.body.CallSid;
    logger.info(`Call status update: ${callSid} is ${status}`);

    // Release lock if the call has ended
    if (status === 'completed' || status === 'busy' || status === 'failed' || status === 'no-answer' || status === 'canceled') {
       const { markCallEnded } = await import('../services/dripService.js');
       markCallEnded(callSid);
    }

    reply.type('text/xml');
    return reply.send('<Response></Response>');
  } catch (error) {
    logger.error('Error handling inbound status:', error);
    return reply.code(500).send('Internal Server Error');
  }
};

export const handleWebSocket = (connection, req) => {
  logger.info('New WebSocket connection');

  // Extract WebSocket based on fastify-websocket version
  const ws = connection.socket ? connection.socket : connection;
  let callSid = 'unknown';

  const openAIService = new OpenAIRealtimeService(ws, callSid);
  openAIService.connect();

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;

        const customParams = data.start.customParameters || {};
        const callerId = customParams.callerId || 'unknown';
        const mode = customParams.mode || 'inbound';

        openAIService.callSid = callSid;
        openAIService.callerId = callerId;
        openAIService.mode = mode;

        logger.info(`Call ${callSid} started in ${mode} mode with CallerID ${callerId}`);

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

    // Release outbound lock just in case it wasn't caught by status
    if (callSid && callSid !== 'unknown') {
        const { markCallEnded } = await import('../services/dripService.js');
        markCallEnded(callSid);
    }
  });
};