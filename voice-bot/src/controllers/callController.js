import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = async (request, reply) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();

    const callerId = request.query?.callerId || request.body?.From || 'unknown';
    const callerIdQuery = encodeURIComponent(callerId);

    // Using mode=inbound for the receptionist persona
    connect.stream({
      url: `wss://${request.headers.host}/voice/stream?callerId=${callerIdQuery}&mode=inbound`,
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
    const { CallSid, CallStatus } = request.body;
    logger.info(`Call status update: ${CallSid} is now ${CallStatus}`);

    // When a call reaches a terminal state, release the outbound drip lock
    if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(CallStatus)) {
      const { markCallEnded } = await import('../services/dripService.js');
      markCallEnded(CallSid);
    }

    return reply.code(200).send('OK');
  } catch (error) {
    logger.error('Error processing call status:', error);
    return reply.code(500).send('Internal Server Error');
  }
};

export const handleWebSocket = (connection, request) => {
  const ws = connection.socket ? connection.socket : connection;
  logger.info('New WebSocket connection');

  const callerId = request.query?.callerId || 'unknown';
  const mode = request.query?.mode || 'inbound';
  let callSid = 'unknown';

  const openAIService = new OpenAIRealtimeService(ws, callSid, callerId, mode);
  openAIService.connect();

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;
        openAIService.callSid = callSid;
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
