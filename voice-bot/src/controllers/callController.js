import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';
import { setCallActive } from '../services/dripService.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = async (request, reply) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();

    // Check if CallSid is in query params (passed from client) or body (from Twilio)
    const callSid = request.query.callSid || request.body.CallSid || 'unknown';
    const clientId = request.query.clientId || 'unknown';

    // Construct WebSocket URL
    const host = request.headers.host;
    const streamUrl = `wss://${host}/voice/stream?callSid=${callSid}&clientId=${clientId}`;

    const stream = connect.stream({
      url: streamUrl,
    });

    reply.type('text/xml').send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const handleCallStatus = async (request, reply) => {
    const callStatus = request.body.CallStatus;
    const callSid = request.body.CallSid;
    logger.info(`Call status update for ${callSid}: ${callStatus}`);

    if (['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(callStatus)) {
        setCallActive(false);
        logger.info('Call ended, resetting active status.');
    }

    reply.status(200).send();
};

export const handleWebSocket = (connection, req) => {
  logger.info('New WebSocket connection');
  const ws = connection.socket; // Fastify WebSocket object

  // Extract CallSid from query params
  const callSid = req.query.callSid || 'unknown';
  const clientId = req.query.clientId || 'unknown';

  const openAIService = new OpenAIRealtimeService(ws, callSid, clientId);
  openAIService.connect();

  // Register service instance
  setCallActive(true, openAIService);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        const streamSid = data.start.streamSid;
        const twilioCallSid = data.start.callSid;

        // Update CallSid if needed
        if (openAIService.callSid === 'unknown') {
            openAIService.callSid = twilioCallSid;
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

  ws.on('close', () => {
    logger.info('WebSocket connection closed');
    if (openAIService.openaiWs) {
        openAIService.openaiWs.close();
    }
    setCallActive(false);
  });
};
