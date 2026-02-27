import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';
import { handleCallStatusUpdate } from '../services/dripService.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = async (req, reply) => {
  try {
    logger.info('Incoming call received');

    // Fastify puts query in req.query and body in req.body
    const callerId = req.query.callerId || req.body.From || 'Unknown';

    const response = new VoiceResponse();
    const connect = response.connect();

    // Use public URL from config for robustness, replacing protocol
    // config.server.publicUrl usually starts with https://
    let streamUrl = config.server.publicUrl.replace(/^https/, 'wss');
    // If it doesn't have protocol or is http, handle accordingly, but let's assume standard https public url
    if (!streamUrl.startsWith('wss://') && !streamUrl.startsWith('ws://')) {
         streamUrl = `wss://${req.headers.host}`; // Fallback
    }
    streamUrl += '/voice/stream';

    const stream = connect.stream({
      url: streamUrl,
    });

    stream.parameter({
        name: 'callerId',
        value: callerId
    });

    reply.type('text/xml');
    return response.toString();
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const callStatusCallback = async (req, reply) => {
    const callSid = req.body.CallSid;
    const callStatus = req.body.CallStatus;

    handleCallStatusUpdate(callSid, callStatus);

    reply.status(200).send();
};

// WebSocket Handler (for Fastify @fastify/websocket)
// The signature for websocket handler in fastify is (connection, req)
export const handleWebSocket = (connection, req) => {
  const ws = connection.socket; // Correctly access the socket object
  logger.info('New WebSocket connection');

  let callSid = 'unknown';
  const openAIService = new OpenAIRealtimeService(ws, callSid);
  openAIService.connect();

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString()); // Safely convert buffer to string

      if (data.event === 'start') {
        callSid = data.start.callSid;
        openAIService.callSid = callSid;

        const customParams = data.start.customParameters;
        if (customParams && customParams.callerId) {
            logger.info(`Call started with CallerID: ${customParams.callerId}`);
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
  });
};
