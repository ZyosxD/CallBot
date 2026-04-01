import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = async (req, reply) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();

    // From req.body.From
    const callerId = (req.body && req.body.From) ? req.body.From : 'unknown';

    // The stream URL uses wss://${req.headers.host}/voice/stream
    const stream = connect.stream({
      url: `wss://${req.headers.host}/voice/stream`,
    });

    // We can pass mode=inbound and callerId
    stream.parameter({ name: 'mode', value: 'inbound' });
    stream.parameter({ name: 'callerId', value: callerId });

    reply.type('text/xml');
    reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const handleWebSocket = (ws, req) => {
  logger.info('New WebSocket connection');

  let callSid = 'unknown';
  let callerId = 'unknown';
  let mode = 'inbound'; // default

  // Check req.query for outbound drip callerId / mode
  if (req.query && req.query.callerId) {
     callerId = req.query.callerId;
  }
  if (req.query && req.query.mode) {
     mode = req.query.mode;
  }

  // We instantiate with nulls first, then populate on start event
  const openAIService = new OpenAIRealtimeService(ws, callSid, callerId, mode);
  openAIService.connect();

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;
        openAIService.callSid = callSid;

        // Extract customParameters if they exist
        if (data.start.customParameters) {
          if (data.start.customParameters.mode) {
             openAIService.mode = data.start.customParameters.mode;
          }
          if (data.start.customParameters.callerId) {
             openAIService.callerId = data.start.customParameters.callerId;
          }
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
  });
};
