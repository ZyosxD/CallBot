import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = async (req, reply) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();

    // Inject custom parameters into the stream for inbound calls
    const stream = connect.stream({
      url: `wss://${req.headers.host}/voice/stream`,
    });

    stream.parameter({
        name: 'mode',
        value: 'inbound'
    });

    stream.parameter({
        name: 'callerId',
        value: req.body.From || 'unknown'
    });

    reply.type('text/xml');
    return reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    return reply.status(500).send('Internal Server Error');
  }
};

import { markCallEnded } from '../services/dripService.js';

export const statusCallback = async (req, reply) => {
    logger.info(`Call Status Callback: ${req.body.CallStatus} for ${req.body.CallSid}`);

    if (req.body.CallStatus === 'completed' || req.body.CallStatus === 'failed' || req.body.CallStatus === 'busy' || req.body.CallStatus === 'no-answer' || req.body.CallStatus === 'canceled') {
        markCallEnded(req.body.CallSid);
    }

    reply.status(200).send('OK');
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

        // Extract parameters
        const customParams = data.start.customParameters || {};
        const mode = customParams.mode || 'unknown';
        const callerId = customParams.callerId || 'unknown';

        openAIService.callSid = callSid;
        openAIService.mode = mode;
        openAIService.callerId = callerId;
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
