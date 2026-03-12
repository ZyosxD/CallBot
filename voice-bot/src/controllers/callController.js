import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import { markCallEnded } from '../services/dripService.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = (req, reply) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();

    // Reconstruct the host URL safely for Fastify websocket routing
    const wssUrl = `wss://${req.headers.host}/voice/stream`;

    const stream = connect.stream({
      url: wssUrl,
    });

    stream.parameter({ name: 'callerId', value: req.body.From || 'Unknown' });
    stream.parameter({ name: 'mode', value: 'inbound' });

    reply.type('text/xml');
    reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const statusCallback = (req, reply) => {
  try {
    const { CallSid, CallStatus } = req.body;
    logger.info(`Status callback received. SID: ${CallSid}, Status: ${CallStatus}`);

    if (CallStatus === 'completed' || CallStatus === 'failed' || CallStatus === 'busy' || CallStatus === 'no-answer' || CallStatus === 'canceled') {
      markCallEnded(CallSid);
    }

    reply.send('OK');
  } catch (error) {
    logger.error('Error in status callback:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const handleWebSocket = (connection, req) => {
  const ws = connection;
  logger.info('New WebSocket connection');

  let callSid = 'unknown';
  let callerId = 'unknown';
  let mode = 'inbound'; // Default to inbound

  const openAIService = new OpenAIRealtimeService(ws, callSid, callerId, mode);
  openAIService.connect();

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;
        openAIService.callSid = callSid;

        // Custom parameters come from TwiML stream tags
        if (data.start.customParameters) {
           callerId = data.start.customParameters.callerId || callerId;
           mode = data.start.customParameters.mode || mode;
           openAIService.callerId = callerId;
           openAIService.mode = mode;
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
    markCallEnded(callSid);
  });
};
