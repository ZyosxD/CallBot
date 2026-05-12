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

    // Optional chaining as per fastify formbody
    const direction = request.body?.Direction;
    const isOutbound = direction === 'outbound-api';
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
    reply.status(500).send('Internal Server Error');
  }
};

export const inboundStatus = async (request, reply) => {
  const callSid = request.body?.CallSid;
  const status = request.body?.CallStatus;

  if (callSid && ['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(status)) {
    logger.info(`Call ${callSid} status changed to ${status}. Marking as ended.`);
    markCallEnded(callSid);
  }

  reply.send({ success: true });
}

export const handleWebSocket = (ws, req) => {
  logger.info('New WebSocket connection');

  let callSid = 'unknown';
  let openAIService = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;

        // Retrieve custom parameters
        const customParams = data.start.customParameters || {};
        const callerId = customParams.callerId || 'unknown';
        const mode = customParams.mode || 'inbound';

        openAIService = new OpenAIRealtimeService(ws, callSid, callerId, mode);
        openAIService.connect();
        openAIService.handleTwilioMedia(data);
      } else if (data.event === 'media') {
        if (openAIService) {
           openAIService.handleTwilioMedia(data);
        }
      } else if (data.event === 'stop') {
        logger.info(`Stream stopped for call ${callSid}`);
        if (openAIService) {
           openAIService.handleTwilioStop();
        }
        markCallEnded(callSid);
        ws.close();
      }
    } catch (error) {
      logger.error('Error processing WebSocket message:', error);
    }
  });

  ws.on('close', async () => {
    logger.info(`WebSocket connection closed for call ${callSid}`);
    if (openAIService && openAIService.openaiWs) {
        openAIService.openaiWs.close();
    }
    const { markCallEnded } = await import('../services/dripService.js');
    markCallEnded(callSid);
  });
};