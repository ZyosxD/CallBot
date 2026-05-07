import twilio from 'twilio';
import logger from '../utils/logger.js';
import { OpenAIRealtimeService } from '../services/openaiRealtime.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = (request, reply) => {
  try {
    logger.info('Incoming call received or API initiated');
    const response = new VoiceResponse();
    const connect = response.connect();

    // Dynamically construct WebSocket URL using request.headers.host
    const streamUrl = `wss://${request.headers.host}/voice/stream`;

    // Check if it's outbound via API
    const isOutbound = request.body?.Direction === 'outbound-api';
    const callerId = isOutbound ? request.body?.To : request.body?.From;
    const mode = isOutbound ? 'outbound' : 'inbound';

    const stream = connect.stream({
      url: streamUrl
    });

    // DO NOT CHAIN: Call parameter individually to avoid TypeError
    stream.parameter({ name: 'callerId', value: callerId || 'unknown' });
    stream.parameter({ name: 'mode', value: mode });

    reply.type('text/xml');
    return reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    return reply.status(500).send('Internal Server Error');
  }
};

export const inboundStatus = async (request, reply) => {
  try {
    const callStatus = request.body?.CallStatus;
    const callSid = request.body?.CallSid;

    logger.info(`Call Status Update: ${callSid} is ${callStatus}`);

    if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(callStatus)) {
      const { markCallEnded } = await import('../services/dripService.js');
      markCallEnded(callSid);
    }

    return reply.code(200).send('OK');
  } catch (error) {
    logger.error('Error handling inbound status:', error);
    return reply.code(500).send('Error');
  }
};

export const handleWebSocket = (connection, req) => {
  // fastify/websocket v11 wrapper
  const ws = connection.socket ? connection.socket : connection;
  logger.info('New WebSocket connection');

  let callSid = 'unknown';
  let callerId = 'unknown';
  let mode = 'inbound';
  let openAIService = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;

        // Extract custom parameters
        if (data.start.customParameters) {
          callerId = data.start.customParameters.callerId || callerId;
          mode = data.start.customParameters.mode || mode;
        }

        logger.info(`Twilio Stream started. CallSid: ${callSid}, Mode: ${mode}, CallerId: ${callerId}`);

        openAIService = new OpenAIRealtimeService(ws, callSid, callerId, mode);
        openAIService.connect();
        openAIService.handleTwilioMedia(data);

      } else if (data.event === 'media') {
        if (openAIService) {
          openAIService.handleTwilioMedia(data);
        }
      } else if (data.event === 'stop') {
        logger.info(`Stream stopped for call ${callSid}`);
        if (openAIService && openAIService.openaiWs) {
          openAIService.openaiWs.close();
        }
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

    // Dynamically import to resolve lock when socket closes unexpectedly
    try {
      const { markCallEnded } = await import('../services/dripService.js');
      markCallEnded(callSid);
    } catch(err) {
      logger.error('Error releasing lock on socket close:', err);
    }
  });
};
