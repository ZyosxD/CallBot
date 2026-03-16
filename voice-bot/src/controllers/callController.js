import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { markCallEnded } from '../services/dripService.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = (request, reply) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();

    const callerId = request.body.From || 'Unknown';

    const stream = connect.stream({
      url: `wss://${request.headers.host}/voice/stream`,
    });

    stream.parameter({
      name: 'callerId',
      value: callerId
    });
    stream.parameter({
      name: 'mode',
      value: 'inbound'
    });

    reply.type('text/xml');
    reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const handleStatusCallback = (request, reply) => {
  try {
    const { CallSid, CallStatus } = request.body;
    logger.info(`Call status update: ${CallSid} is ${CallStatus}`);

    if (['completed', 'failed', 'busy', 'no-answer', 'canceled'].includes(CallStatus)) {
      markCallEnded(CallSid);
    }

    reply.status(200).send('OK');
  } catch (error) {
    logger.error('Error handling status callback:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const handleWebSocket = (connection, req) => {
  logger.info('New WebSocket connection');

  let callSid = 'unknown';
  let openAIService = null;

  connection.socket.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;

        const callerId = data.start.customParameters?.callerId || 'unknown';
        const mode = data.start.customParameters?.mode || 'inbound';

        openAIService = new OpenAIRealtimeService(connection.socket, callSid, callerId, mode);
        openAIService.connect();
        openAIService.handleTwilioMedia(data);
      } else if (data.event === 'media' && openAIService) {
        openAIService.handleTwilioMedia(data);
      } else if (data.event === 'stop') {
        logger.info(`Stream stopped for call ${callSid}`);
        connection.socket.close();
      }
    } catch (error) {
      logger.error('Error processing WebSocket message:', error);
    }
  });

  connection.socket.on('close', () => {
    logger.info('WebSocket connection closed');
    if (openAIService && openAIService.openaiWs) {
        openAIService.openaiWs.close();
    }
    markCallEnded(callSid);
  });
};
