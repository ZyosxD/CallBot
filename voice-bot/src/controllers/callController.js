import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = async (request, reply) => {
  try {
    logger.info('Incoming call received');
    const callerId = (request.body && request.body.From) ? request.body.From : 'unknown';

    const response = new VoiceResponse();
    const connect = response.connect();

    // Inject parameters to pass to WebSocket
    const stream = connect.stream({
      url: `wss://${request.headers.host}/voice/stream`,
    });
    stream.parameter({ name: 'callerId', value: callerId });
    stream.parameter({ name: 'mode', value: 'inbound' });

    reply.type('text/xml');
    reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.code(500).send('Internal Server Error');
  }
};

export const outboundTwiml = async (request, reply) => {
  try {
    const callerId = (request.query && request.query.callerId) ? request.query.callerId : 'unknown';
    logger.info(`Generating TwiML for outbound call to ${callerId}`);

    const response = new VoiceResponse();
    const connect = response.connect();

    // The stream URL needs to point to the websocket
    const stream = connect.stream({
      url: `wss://${request.headers.host}/voice/stream`,
    });
    stream.parameter({ name: 'callerId', value: callerId });
    stream.parameter({ name: 'mode', value: 'outbound' });

    reply.type('text/xml');
    reply.send(response.toString());
  } catch (error) {
    logger.error('Error generating outbound TwiML:', error);
    reply.code(500).send('Internal Server Error');
  }
};

export const handleWebSocket = (connection, req) => {
  logger.info('New WebSocket connection');

  // Fastify websocket v11 provides socket directly if accessed, or connection.socket
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

        // Extract custom parameters sent from TwiML
        if (data.start.customParameters) {
            callerId = data.start.customParameters.callerId || 'unknown';
            mode = data.start.customParameters.mode || 'inbound';
        }

        logger.info(`Stream started: Mode=${mode}, CallerId=${callerId}, CallSid=${callSid}`);

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