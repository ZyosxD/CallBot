import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = (request, reply) => {
  try {
    logger.info('Call received (inbound or outbound webhook)');
    const response = new VoiceResponse();
    const connect = response.connect();
    const stream = connect.stream({
      url: `wss://${request.headers.host}/voice/stream`,
    });

    // Detect if this is an outbound call from the API (Smart Drip) or inbound (Receptionist)
    const isOutbound = request.body?.Direction === 'outbound-api';
    const callerId = isOutbound ? request.body?.To : request.body?.From;
    const mode = isOutbound ? 'outbound' : 'inbound';

    stream.parameter({
        name: 'callerId',
        value: callerId || 'unknown'
    });

    stream.parameter({
        name: 'mode',
        value: mode
    });

    reply.type('text/xml');
    reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling call:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const inboundStatus = async (request, reply) => {
    const callStatus = request.body?.CallStatus;
    const callSid = request.body?.CallSid;

    logger.info(`Call Status Update: ${callSid} is ${callStatus}`);

    if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(callStatus)) {
        try {
            const { markCallEnded } = await import('../services/dripService.js');
            markCallEnded(callSid);
        } catch (err) {
            logger.error('Error importing or calling markCallEnded:', err);
        }
    }

    reply.send('OK');
};

export const handleWebSocket = (connection, req) => {
  logger.info('New WebSocket connection');

  // Fastify websocket instance is accessed differently depending on version
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

        // Extract parameters set in TwiML
        const customParams = data.start.customParameters || {};
        openAIService.callerId = customParams.callerId;
        openAIService.mode = customParams.mode;

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

    // Release lock in Drip service if websocket drops unexpectedly
    try {
        const { markCallEnded } = await import('../services/dripService.js');
        markCallEnded(callSid);
    } catch (err) {
        logger.error('Error importing or calling markCallEnded on ws close:', err);
    }
  });
};
