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

    // Memory rule: Dynamically detect if a call is outbound by checking request.body?.Direction === 'outbound-api'
    // which determines if the callerId should use request.body?.To (outbound) or request.body?.From (inbound)
    // and what mode flag to set.

    const direction = request.body?.Direction;
    const isOutbound = direction === 'outbound-api';
    const callerId = isOutbound ? request.body?.To : request.body?.From;
    const mode = isOutbound ? 'outbound' : 'inbound';

    const stream = connect.stream({
      // The WebSocket route inside the router must be defined relative to the prefix (e.g., fastify.get('/stream', ...)). The Twilio TwiML stream URL must use the absolute path (e.g., wss://${request.headers.host}/voice/stream).
      url: `wss://${request.headers.host}/voice/stream`,
    });

    // Memory rule: store the stream reference and call .parameter() on it individually. Do not chain multiple .parameter() calls.
    stream.parameter({ name: 'mode', value: mode });
    stream.parameter({ name: 'callerId', value: callerId || 'unknown' });

    reply.type('text/xml');
    reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.code(500).send('Internal Server Error');
  }
};

export const handleWebSocket = (ws, req) => {
  logger.info('New WebSocket connection');

  let callSid = 'unknown';

  const openAIService = new OpenAIRealtimeService(ws, callSid);
  openAIService.connect();

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;
        openAIService.callSid = callSid;

        // Extract parameters from Twilio start event payload
        if (data.start.customParameters) {
            openAIService.mode = data.start.customParameters.mode;
            openAIService.callerId = data.start.customParameters.callerId;
        }

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

    // To prevent Smart Drip deadlocks, dynamically import and call markCallEnded(callSid)
    if (callSid && callSid !== 'unknown') {
       try {
           const { markCallEnded } = await import('../services/dripService.js');
           markCallEnded(callSid);
       } catch (err) {
           logger.error('Error calling markCallEnded:', err);
       }
    }
  });
};