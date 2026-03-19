import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';
import { markCallEnded } from '../services/dripService.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = async (request, reply) => {
  try {
    logger.info('Incoming call received');
    const callerId = (request.body && request.body.From) ? request.body.From : 'unknown';

    const response = new VoiceResponse();
    const connect = response.connect();

    // Inject mode and callerId to Stream Parameters
    const stream = connect.stream({
      url: `wss://${request.headers.host}/voice/stream`,
    });

    stream.parameter({
      name: 'mode',
      value: 'inbound'
    });

    stream.parameter({
      name: 'callerId',
      value: callerId
    });

    reply.type('text/xml');
    reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const statusCallback = async (request, reply) => {
  try {
    const status = request.body.CallStatus;
    const callSid = request.body.CallSid;

    logger.info(`Call Status Update for ${callSid}: ${status}`);

    if (['completed', 'failed', 'busy', 'no-answer', 'canceled'].includes(status)) {
       markCallEnded(callSid);
    }

    reply.send('OK');
  } catch (error) {
    logger.error('Error in status callback:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const handleWebSocket = (connection, request) => {
  logger.info('New WebSocket connection');

  const ws = connection;

  let callSid = 'unknown';
  let callerId = 'unknown';
  let mode = 'inbound';

  // We initialize the AI service, but don't connect yet. We wait for 'start' event from Twilio
  const openAIService = new OpenAIRealtimeService(ws, callSid, callerId, mode);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;

        // Extract parameters from Twilio Stream
        const customParams = data.start.customParameters || {};
        callerId = customParams.callerId || 'unknown';
        mode = customParams.mode || 'inbound';

        openAIService.callSid = callSid;
        openAIService.callerId = callerId;
        openAIService.mode = mode;

        openAIService.connect(); // Connect to OpenAI now that we have details
        openAIService.handleTwilioMedia(data);
      } else if (data.event === 'media') {
        openAIService.handleTwilioMedia(data);
      } else if (data.event === 'stop') {
        logger.info(`Stream stopped for call ${callSid}`);
        if (openAIService.openaiWs) {
          openAIService.openaiWs.close();
        }
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
