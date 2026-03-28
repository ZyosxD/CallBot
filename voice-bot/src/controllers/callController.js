import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';
import { markCallEnded } from '../services/dripService.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = (request, reply) => {
  try {
    const mode = request.query.mode || 'inbound';

    // Safety check for body parsing issues, sometimes From is not present
    const callerId = mode === 'inbound'
      ? ((request.body && request.body.From) ? request.body.From : 'unknown')
      : request.query.callerId;

    logger.info(`${mode === 'inbound' ? 'Incoming' : 'Outbound'} call received from/to ${callerId}`);

    const response = new VoiceResponse();
    const connect = response.connect();

    // Fastify request.headers.host provides the hostname
    const host = request.headers.host;

    const stream = connect.stream({
      url: `wss://${host}/voice/stream`,
    });

    stream.parameter({
      name: 'mode',
      value: mode
    });
    stream.parameter({
      name: 'callerId',
      value: callerId
    });

    reply.type('text/xml');
    reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling call:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const statusCallback = (request, reply) => {
  const { CallStatus, CallSid } = request.body;

  if (CallStatus === 'completed' || CallStatus === 'failed' || CallStatus === 'busy' || CallStatus === 'no-answer' || CallStatus === 'canceled') {
    logger.info(`Call ${CallSid} ended with status: ${CallStatus}`);
    markCallEnded(CallSid);
  }

  reply.status(200).send();
};

export const handleWebSocket = (ws, req) => {
  logger.info('New WebSocket connection');

  let callSid = 'unknown';
  let callerId = 'unknown';
  let mode = 'inbound';

  // Will assign correct parameters when Twilio sends the 'start' event
  const openAIService = new OpenAIRealtimeService(ws, callSid, callerId, mode);
  openAIService.connect();

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;

        // Extract custom parameters sent via TwiML stream
        if (data.start.customParameters) {
          callerId = data.start.customParameters.callerId || 'unknown';
          mode = data.start.customParameters.mode || 'inbound';
        }

        openAIService.callSid = callSid;
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

  ws.on('close', () => {
    logger.info('WebSocket connection closed');
    if (openAIService.openaiWs) {
        openAIService.openaiWs.close();
    }
  });
};
