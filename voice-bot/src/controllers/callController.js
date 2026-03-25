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

    const callerId = (req.body && req.body.From) ? req.body.From : 'unknown';
    const mode = 'inbound';

    const stream = connect.stream({
      url: `wss://${req.headers.host}/voice/stream`,
    });

    stream.parameter({ name: 'callerId', value: callerId });
    stream.parameter({ name: 'mode', value: mode });

    reply.type('text/xml');
    return reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const statusCallback = async (req, reply) => {
  const callSid = req.body.CallSid;
  const status = req.body.CallStatus;

  if (['completed', 'failed', 'busy', 'no-answer', 'canceled'].includes(status)) {
    markCallEnded(callSid);
  }

  reply.status(200).send();
};

export const handleWebSocket = (connection, req) => {
  logger.info('New WebSocket connection');

  const ws = connection.socket ? connection.socket : connection;
  let callSid = 'unknown';
  let callerId = 'unknown';
  let mode = 'inbound';

  const openAIService = new OpenAIRealtimeService(ws, callSid, callerId, mode);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;

        if (data.start.customParameters) {
          callerId = data.start.customParameters.callerId || 'unknown';
          mode = data.start.customParameters.mode || 'inbound';
        }

        openAIService.callSid = callSid;
        openAIService.callerId = callerId;
        openAIService.mode = mode;

        openAIService.handleTwilioMedia(data);
        openAIService.connect(); // Delay connection until we have the correct mode
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
