import twilio from 'twilio';
import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import logger from '../utils/logger.js';
import eventBus from '../utils/events.js';
import { config } from '../config/config.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const handleInboundCall = async (req, reply) => {
  try {
    const { direction, clientId, phone } = req.query; // For outbound calls triggered by us
    const callerId = req.body.From; // For actual inbound calls

    logger.info(`Incoming call request. Direction: ${direction || 'inbound'}`);

    const response = new VoiceResponse();
    const connect = response.connect();

    // Construct stream URL with parameters
    // If it's an outbound call triggered by us, we have clientId and verified phone
    // If it's an inbound call, we might not have clientId, so we use callerId

    const baseUrl = config.server.publicUrl.replace('http', 'ws');
    const streamUrl = new URL(`${baseUrl}/voice/stream`);

    if (clientId) streamUrl.searchParams.append('clientId', clientId);
    if (phone) streamUrl.searchParams.append('phone', phone);
    if (direction) streamUrl.searchParams.append('direction', direction);
    // Also pass callerId if it's inbound
    if (!direction) {
        streamUrl.searchParams.append('phone', callerId);
        streamUrl.searchParams.append('direction', 'inbound');
    }

    connect.stream({
      url: streamUrl.toString(),
    });

    reply.type('text/xml');
    reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.code(500).send('Internal Server Error');
  }
};

export const handleWebSocket = (connection, req) => {
  logger.info('New WebSocket connection');

  const ws = connection.socket;

  // Extract params from query
  // fastify-websocket puts query params in req.query ?? No, req is standard http request
  // We can parse the url from req.url
  const url = new URL(req.url, `http://${req.headers.host}`);
  const clientId = url.searchParams.get('clientId');
  const phone = url.searchParams.get('phone');
  const direction = url.searchParams.get('direction');

  const callDetails = { clientId, phone, direction };
  let callSid = 'unknown'; // Will be updated on start event

  const openAIService = new OpenAIRealtimeService(ws, callSid, callDetails);
  openAIService.connect();

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;
        openAIService.callSid = callSid;
        openAIService.handleTwilioMedia(data);
        logger.info(`Call started: ${callSid} for Client: ${clientId || 'Unknown'}`);
      } else if (data.event === 'media') {
        openAIService.handleTwilioMedia(data);
      } else if (data.event === 'stop') {
        logger.info(`Stream stopped for call ${callSid}`);
        openAIService.handleTwilioMedia(data);
        // ws.close() is handled by service cleanup usually, but we can ensure it here
      } else if (data.event === 'mark') {
          // specific mark events if needed
      }
    } catch (error) {
      logger.error('Error processing WebSocket message:', error);
    }
  });

  ws.on('close', () => {
    logger.info('WebSocket connection closed');
    openAIService.cleanup();
  });

  ws.on('error', (err) => {
      logger.error('WebSocket error:', err);
      openAIService.cleanup();
  });
};

export const handleCallStatus = async (req, reply) => {
    const { CallSid, CallStatus } = req.body;
    logger.info(`Call Status Update: ${CallSid} is ${CallStatus}`);

    // If call failed or completed without connecting to stream (e.g. busy, no-answer)
    // We need to ensure the drip service knows it ended.
    if (['busy', 'no-answer', 'failed', 'canceled'].includes(CallStatus)) {
        logger.info(`Call ${CallSid} was not successful (${CallStatus}). Triggering next drip.`);
        eventBus.emit('callEnded', CallSid);
    }

    reply.send('OK');
};
