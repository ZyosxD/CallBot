import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { markCallEnded } from '../services/dripService.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = async (req, reply) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();

    // Extract callerId from the request body (Fastify syntax)
    const callerId = (req.body && req.body.From) ? req.body.From : 'unknown';

    // Inject mode and callerId as custom parameters
    connect.stream({
      url: `wss://${req.headers.host}/voice/stream`,
    })
      .parameter({ name: 'mode', value: 'inbound' })
      .parameter({ name: 'callerId', value: callerId });

    reply.type('text/xml');
    reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const outboundCall = async (req, reply) => {
  try {
    const callerId = req.query.callerId || 'unknown';
    logger.info(`Generating TwiML for outbound call to ${callerId}`);

    const response = new VoiceResponse();
    const connect = response.connect();

    // Inject mode and callerId as custom parameters
    connect.stream({
      url: `wss://${req.headers.host}/voice/stream`,
    })
      .parameter({ name: 'mode', value: 'outbound' })
      .parameter({ name: 'callerId', value: callerId });

    reply.type('text/xml');
    reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling outbound TwiML:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const callStatus = async (req, reply) => {
  try {
    const status = req.body.CallStatus;
    const callSid = req.body.CallSid;

    logger.info(`Status callback for CallSid ${callSid}: ${status}`);

    if (status === 'completed' || status === 'failed' || status === 'busy' || status === 'no-answer' || status === 'canceled') {
      markCallEnded(callSid);
    }

    reply.send('OK');
  } catch (error) {
    logger.error('Error handling status callback:', error);
    reply.status(500).send('Error');
  }
};

export const handleWebSocket = (ws, req) => {
  logger.info('New WebSocket connection');

  let callSid = 'unknown';
  let callerId = 'unknown';
  let mode = 'inbound';
  let openAIService = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;

        // Retrieve custom parameters
        const customParams = data.start.customParameters || {};
        callerId = customParams.callerId || 'unknown';
        mode = customParams.mode || 'inbound';

        openAIService = new OpenAIRealtimeService(ws, callSid, callerId, mode);
        openAIService.connect();

        // Provide the start event to initialize streams immediately
        // after connect resolves, though wait till we're sure it's constructed
        setTimeout(() => openAIService.handleTwilioMedia(data), 50);

      } else if (data.event === 'media') {
        if (openAIService) {
          openAIService.handleTwilioMedia(data);
        }
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
    if (openAIService && openAIService.openaiWs) {
        openAIService.openaiWs.close();
    }
  });
};
