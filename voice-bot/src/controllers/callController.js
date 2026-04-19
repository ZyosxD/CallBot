import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { markCallEnded } from '../services/dripService.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = async (request, reply) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();

    // Default fallback from caller
    const callerId = request.body?.From || 'unknown';

    const stream = connect.stream({
      url: `wss://${request.headers.host}/voice/stream`,
    });

    // Inject parameters for inbound calls
    stream.parameter({ name: 'mode', value: 'inbound' });
    stream.parameter({ name: 'callerId', value: callerId });

    reply.type('text/xml');
    return reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    return reply.status(500).send('Internal Server Error');
  }
};

export const inboundStatus = async (request, reply) => {
  try {
    const status = request.body?.CallStatus;
    const callSid = request.body?.CallSid;

    logger.info(`Call status update for ${callSid}: ${status}`);

    // Terminal states should release the outbound lock
    if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(status)) {
      await markCallEnded(callSid);
    }

    return reply.status(200).send('OK');
  } catch (error) {
    logger.error('Error handling inbound status:', error);
    return reply.status(500).send('Internal Server Error');
  }
};

export const handleWebSocket = (ws, req) => {
  logger.info('New WebSocket connection');

  let callSid = 'unknown';
  // Mode and callerId will be updated once 'start' event with customParameters is received
  const openAIService = new OpenAIRealtimeService(ws, callSid);
  openAIService.connect();

  ws.on('message', async (message) => {
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
        await markCallEnded(callSid); // Dynamically handle end of stream lock release
        ws.close();
      }
    } catch (error) {
      logger.error('Error processing WebSocket message:', error);
    }
  });

  ws.on('close', async () => {
    logger.info('WebSocket connection closed');
    await markCallEnded(callSid); // Ensure lock is released even if disconnect is abrupt
    if (openAIService.openaiWs) {
        openAIService.openaiWs.close();
    }
  });
};
