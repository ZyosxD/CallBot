import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = async (request, reply) => {
  try {
    logger.info('Incoming/Outgoing call received via TwiML route');
    const response = new VoiceResponse();

    // Dynamically detect if a call is outbound by checking Direction
    const isOutbound = request.body?.Direction === 'outbound-api';
    const callerId = isOutbound ? request.body?.To : request.body?.From;
    const mode = isOutbound ? 'SARAH_OUTBOUND' : 'SARAH_INBOUND';

    const connect = response.connect();
    const stream = connect.stream({
      url: `wss://${request.headers.host}/voice/stream`,
    });

    // Add custom parameters individually
    stream.parameter({ name: 'callerId', value: callerId || 'unknown' });
    stream.parameter({ name: 'mode', value: mode });

    reply.type('text/xml').send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.code(500).send('Internal Server Error');
  }
};

export const inboundStatus = async (request, reply) => {
  try {
    const callSid = request.body?.CallSid;
    const callStatus = request.body?.CallStatus;
    logger.info(`Call Status Update: ${callSid} is now ${callStatus}`);

    if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(callStatus)) {
      const { markCallEnded } = await import('../services/dripService.js');
      markCallEnded(callSid);
    }
    reply.send('OK');
  } catch (error) {
    logger.error('Error handling inbound status:', error);
    reply.code(500).send('Internal Server Error');
  }
};

export const handleWebSocket = (connection, request) => {
  logger.info('New WebSocket connection');

  // Safely extract socket for fastify-websocket v11
  const ws = connection.socket ? connection.socket : connection;

  let callSid = 'unknown';
  let callerId = 'unknown';
  let mode = 'SARAH_INBOUND';

  const openAIService = new OpenAIRealtimeService(ws, callSid);
  openAIService.connect();

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;

        // Extract parameters from TwiML Start event
        if (data.start.customParameters) {
          callerId = data.start.customParameters.callerId || callerId;
          mode = data.start.customParameters.mode || mode;
        }

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
    // forcefully release dial lock
    if (callSid !== 'unknown') {
      const { markCallEnded } = await import('../services/dripService.js');
      markCallEnded(callSid);
    }
  });
};
