import twilio from 'twilio';
import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import { releaseCallLock } from '../services/dripService.js';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = async (req, reply) => {
  try {
    logger.info('Incoming call received');
    const callerId = req.body.From || 'unknown';

    const wsUrl = config.server.publicUrl
        ? config.server.publicUrl.replace(/^http/, 'ws') + '/voice/stream'
        : `wss://${req.headers.host}/voice/stream`;

    const response = new VoiceResponse();
    const connect = response.connect();

    // Create Stream and pass parameters matching constructor logic
    const stream = connect.stream({
      url: wsUrl,
    });

    stream.parameter({ name: 'callerId', value: callerId });
    stream.parameter({ name: 'mode', value: 'inbound' });

    reply.type('text/xml');
    return reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const statusCallback = async (req, reply) => {
    try {
        const callStatus = req.body.CallStatus;
        logger.info(`Call Status Update: ${callStatus} for SID: ${req.body.CallSid}`);

        if (callStatus === 'completed' || callStatus === 'failed' || callStatus === 'busy' || callStatus === 'no-answer' || callStatus === 'canceled') {
            logger.info('Call ended. Releasing lock in Drip Service.');
            releaseCallLock();
        }

        reply.status(200).send();
    } catch (error) {
        logger.error('Error in status callback:', error);
        reply.status(500).send();
    }
};

export const handleWebSocket = (connection, req) => {
  logger.info('New WebSocket connection established');

  // Fastify WS v11 gives us the raw connection object
  const ws = connection;

  let callSid = 'unknown';
  let callerId = 'unknown';
  let mode = 'inbound';

  const openAIService = new OpenAIRealtimeService(ws, callSid, callerId, mode);
  openAIService.connect();

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        openAIService.handleTwilioMedia(data);
      } else if (data.event === 'media') {
        openAIService.handleTwilioMedia(data);
      } else if (data.event === 'stop') {
        logger.info(`Stream stopped for call ${openAIService.callSid}`);
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
