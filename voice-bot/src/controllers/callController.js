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
    const callerId = (request.body && request.body.From) ? request.body.From : 'unknown';

    const stream = connect.stream({
      url: `wss://${request.headers.host}/voice/stream`,
    });
    stream.parameter({ name: 'mode', value: 'inbound' });
    stream.parameter({ name: 'callerId', value: callerId });

    reply.type('text/xml');
    reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const statusCallback = (request, reply) => {
  const callSid = request.body.CallSid;
  if (callSid) {
    markCallEnded(callSid);
  }
  reply.status(200).send();
};

export const handleWebSocket = (connection, request) => {
  logger.info('New WebSocket connection');
  const ws = connection.socket ? connection.socket : connection;

  let callSid = 'unknown';
  let callerId = 'unknown';
  let mode = 'inbound';

  let openAIService = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;
        if (data.start.customParameters) {
          callerId = data.start.customParameters.callerId || callerId;
          mode = data.start.customParameters.mode || mode;
        }

        openAIService = new OpenAIRealtimeService(ws, callSid, callerId, mode);
        openAIService.connect();
        openAIService.handleTwilioMedia(data);
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
    logger.info('WebSocket connection closed');
    if (openAIService && openAIService.openaiWs) {
        openAIService.openaiWs.close();
    }
  });
};
