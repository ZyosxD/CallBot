import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { markCallEnded } from '../services/dripService.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = async (request, reply) => {
  try {
    const callerId = request.body.From || 'Unknown';
    logger.info(`Incoming call received from ${callerId}`);

    const response = new VoiceResponse();
    const connect = response.connect();
    const streamUrl = `wss://${request.headers.host}/voice/stream`;

    // Pass mode and callerId to stream
    const stream = connect.stream({ url: streamUrl });
    stream.parameter({ name: 'mode', value: 'inbound' });
    stream.parameter({ name: 'callerId', value: callerId });

    reply.header('Content-Type', 'text/xml');
    return reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    return reply.status(500).send('Internal Server Error');
  }
};

export const handleStatusCallback = async (request, reply) => {
  const { CallStatus, CallSid } = request.body;
  logger.info(`Call ${CallSid} status changed to ${CallStatus}`);

  if (CallStatus === 'completed' || CallStatus === 'failed' || CallStatus === 'busy' || CallStatus === 'no-answer') {
    markCallEnded(CallSid);
  }

  return reply.status(200).send('OK');
};

export const handleWebSocket = (connection, req) => {
  logger.info('New WebSocket connection established');

  let callSid = 'unknown';
  let callerId = 'unknown';
  let mode = 'inbound'; // Default

  // For @fastify/websocket v11, the connection object IS the WebSocket
  const ws = connection;

  // Initialize service temporarily, we'll configure it fully on 'start'
  const openAIService = new OpenAIRealtimeService(ws, callSid, callerId, mode);

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;

        // Extract custom parameters from Twilio start message
        if (data.start.customParameters) {
          callerId = data.start.customParameters.callerId || callerId;
          mode = data.start.customParameters.mode || mode;
        }

        logger.info(`Stream started for callSid: ${callSid}, callerId: ${callerId}, mode: ${mode}`);

        openAIService.callSid = callSid;
        openAIService.callerId = callerId;
        openAIService.mode = mode;

        // Connect to OpenAI after we know the mode
        await openAIService.connect();
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
    logger.info(`WebSocket connection closed for call ${callSid}`);
    if (openAIService.openaiWs && openAIService.openaiWs.readyState === 1) { // 1 = OPEN
      openAIService.openaiWs.close();
    }
    // Safety fallback
    markCallEnded(callSid);
  });
};
