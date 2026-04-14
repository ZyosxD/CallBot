import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = async (request, reply) => {
  try {
    logger.info('Incoming call received');
    const callerId = request.body?.From || 'unknown';

    const response = new VoiceResponse();
    const connect = response.connect();

    // Connect stream and pass callerId and mode
    const stream = connect.stream({
      url: `wss://${request.headers.host}/voice/stream`,
    });
    stream.parameter({ name: 'callerId', value: callerId });
    stream.parameter({ name: 'mode', value: 'inbound' });

    reply.type('text/xml').send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const inboundStatus = async (request, reply) => {
  try {
    const status = request.body?.CallStatus;
    const callSid = request.body?.CallSid;

    logger.info(`Received status callback for call ${callSid}: ${status}`);

    // Release lock if status is terminal
    if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(status)) {
        const { markCallEnded } = await import('../services/dripService.js');
        markCallEnded(callSid);
    }

    reply.send('OK');
  } catch (error) {
    logger.error('Error handling inbound status:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const handleWebSocket = (ws, request) => {
  logger.info('New WebSocket connection');

  let callSid = 'unknown';
  let callerId = 'unknown';
  let mode = 'inbound';

  const openAIService = new OpenAIRealtimeService(ws, callSid);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;
        openAIService.callSid = callSid;

        // Extract parameters injected via TwiML
        if (data.start.customParameters) {
            callerId = data.start.customParameters.callerId || callerId;
            mode = data.start.customParameters.mode || mode;
        }

        openAIService.callerId = callerId;
        openAIService.mode = mode;

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

  ws.on('close', async () => {
    logger.info(`WebSocket connection closed for call ${callSid}`);
    if (openAIService.openaiWs) {
        openAIService.openaiWs.close();
    }

    try {
        const { markCallEnded } = await import('../services/dripService.js');
        markCallEnded(callSid);
    } catch (err) {
        logger.error('Error releasing call lock on WS close:', err);
    }
  });

  openAIService.connect();
};
