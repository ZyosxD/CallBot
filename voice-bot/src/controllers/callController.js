import twilio from 'twilio';
import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import { handleCallEnded } from '../services/dripService.js';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const handleInboundCall = async (req, reply) => {
  try {
    const response = new VoiceResponse();
    const connect = response.connect();
    connect.stream({
      url: `wss://${req.headers.host}/voice/stream`,
    });

    reply.type('text/xml').send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const handleOutboundTwiml = async (req, reply) => {
  try {
    const { clientId } = req.query; // Passed from dripService

    // We can pass the clientId in the stream URL parameters
    const streamUrl = `wss://${req.headers.host}/voice/stream?clientId=${clientId}&direction=outbound`;

    const response = new VoiceResponse();
    const connect = response.connect();
    connect.stream({
      url: streamUrl
    });

    reply.type('text/xml').send(response.toString());
  } catch (error) {
    logger.error('Error handling outbound twiml:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const handleStatusCallback = async (req, reply) => {
  try {
    const { CallSid, CallStatus } = req.body;
    logger.info(`Status callback for ${CallSid}: ${CallStatus}`);

    if (['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(CallStatus)) {
        await handleCallEnded(CallSid, CallStatus);
    }

    reply.send('OK');
  } catch (error) {
    logger.error('Error handling status callback:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const handleWebSocket = (connection, req) => {
  logger.info('New WebSocket connection');

  // Extract clientId from query params if available
  // Fastify request query is in req.query but for WS it might be in req.url or we need to parse it manually
  // In @fastify/websocket, req is a standard Node.js request object usually?
  // But wait, the connection handler receives (connection, req).
  // req is the raw request. We can parse the URL.

  const url = new URL(req.url, `http://${req.headers.host}`);
  const clientId = url.searchParams.get('clientId');
  const callSid = 'pending'; // Will be updated on start event

  const openAIService = new OpenAIRealtimeService(connection.socket, callSid, clientId);
  openAIService.connect();

  connection.socket.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        const streamSid = data.start.streamSid;
        const callSid = data.start.callSid;
        openAIService.callSid = callSid;
        openAIService.streamSid = streamSid;
        openAIService.handleTwilioMedia(data);
      } else if (data.event === 'media') {
        openAIService.handleTwilioMedia(data);
      } else if (data.event === 'stop') {
        logger.info(`Stream stopped for call ${openAIService.callSid}`);
        connection.socket.close();
      }
    } catch (error) {
      logger.error('Error processing WebSocket message:', error);
    }
  });

  connection.socket.on('close', () => {
    logger.info('WebSocket connection closed');
    if (openAIService.openaiWs) {
        openAIService.openaiWs.close();
    }
  });
};
