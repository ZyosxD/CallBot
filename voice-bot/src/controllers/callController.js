import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = async (request, reply) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();

    // We get the host from the request headers
    const host = request.headers.host;
    const stream = connect.stream({
      url: `wss://${host}/voice/stream`,
    });

    const callerId = request.body?.From || 'unknown';

    // Inject parameters for inbound calls
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
  const { CallStatus, CallSid } = request.body || {};

  // Terminal call states
  if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(CallStatus)) {
    logger.info(`Call ${CallSid} ended with status ${CallStatus}. Releasing lock if outbound.`);
    try {
        const { markCallEnded } = await import('../services/dripService.js');
        markCallEnded(CallSid);
    } catch (e) {
        logger.error('Failed to import dripService for markCallEnded', e);
    }
  }

  return reply.code(200).send('OK');
};

export const handleWebSocket = (connection, request) => {
  logger.info('New WebSocket connection');

  const ws = connection.socket ? connection.socket : connection;

  let callSid = 'unknown';
  let callerId = 'unknown';
  let mode = 'inbound';

  const openAIService = new OpenAIRealtimeService(ws, null, null, null);

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;
        callerId = data.start.customParameters?.callerId || 'unknown';
        mode = data.start.customParameters?.mode || 'inbound';

        openAIService.callSid = callSid;
        openAIService.callerId = callerId;
        openAIService.mode = mode;

        // Now connect the OpenAI service after Twilio info is available
        await openAIService.connect();
        openAIService.isTwilioStarted = true;
        openAIService.checkAndInitializeSession();

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

    // Release the outbound lock dynamically
    try {
        const { markCallEnded } = await import('../services/dripService.js');
        markCallEnded(callSid);
    } catch (e) {
        logger.error('Failed to import dripService on ws close', e);
    }
  });
};
