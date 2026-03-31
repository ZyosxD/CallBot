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

    // Handle query string callerId for outbound, else body.From for inbound
    let callerId = 'unknown';
    let mode = 'inbound';

    if (request.query && request.query.callerId) {
      callerId = request.query.callerId;
      mode = 'outbound';
    } else if (request.body && request.body.From) {
      callerId = request.body.From;
    }
    const stream = connect.stream({
      url: `wss://${request.headers.host}/voice/stream`,
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
    logger.error('Error handling inbound call:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const twilioStatusCallback = (request, reply) => {
  try {
    const status = request.body.CallStatus;
    const callSid = request.body.CallSid;
    logger.info(`Call ${callSid} status updated to: ${status}`);

    if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(status)) {
       markCallEnded(callSid);
    }
    reply.status(200).send('OK');
  } catch (error) {
    logger.error('Error handling Twilio status callback:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const handleWebSocket = (connection, request) => {
  logger.info('New WebSocket connection');

  const ws = connection.socket ? connection.socket : connection;

  let callSid = 'unknown';
  let openAIService = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;
        const customParams = data.start.customParameters || {};
        const mode = customParams.mode || 'inbound';
        const callerId = customParams.callerId || 'unknown';

        openAIService = new OpenAIRealtimeService(ws, callSid, callerId, mode);
        openAIService.connect();
        openAIService.handleTwilioMedia(data);
      } else if (data.event === 'media' && openAIService) {
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
    if (openAIService && openAIService.openaiWs) {
        openAIService.openaiWs.close();
    }
  });
};