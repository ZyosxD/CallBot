import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { markCallEnded } from '../services/dripService.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = async (request, reply) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();

    const callerId = (request.body && request.body.From) ? request.body.From : 'unknown';

    const stream = connect.stream({
      url: `wss://${request.headers.host}/voice/stream`,
    });

    // Pass mode and callerId as custom parameters
    stream.parameter({ name: 'mode', value: 'inbound' });
    stream.parameter({ name: 'callerId', value: callerId });

    reply.type('text/xml');
    reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const handleStatusCallback = async (request, reply) => {
    try {
        const body = request.body;
        if (body && body.CallStatus && (body.CallStatus === 'completed' || body.CallStatus === 'failed' || body.CallStatus === 'busy' || body.CallStatus === 'no-answer' || body.CallStatus === 'canceled')) {
             logger.info(`Call Status Update: ${body.CallSid} is now ${body.CallStatus}`);
             markCallEnded(body.CallSid);
        }
        reply.send('OK');
    } catch (error) {
        logger.error('Error handling status callback:', error);
        reply.status(500).send('Internal Server Error');
    }
};

export const handleWebSocket = (connection, req) => {
  logger.info('New WebSocket connection');

  // Handle differences in fastify-websocket v11 vs older versions
  const ws = connection.socket ? connection.socket : connection;

  // Values from Twilio custom parameters in the stream payload
  let callSid = 'unknown';
  let callerId = 'unknown';
  let mode = 'inbound';

  // Custom params sent via query parameters from outbound stream URLs
  if (req.query && req.query.mode) {
      mode = req.query.mode;
  }
  if (req.query && req.query.callerId) {
      callerId = req.query.callerId;
  }

  const openAIService = new OpenAIRealtimeService(ws, callSid, callerId, mode);
  openAIService.connect();

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;

        // Update callerId and mode if provided in customParameters (Inbound)
        if (data.start.customParameters) {
            if (data.start.customParameters.callerId) {
                callerId = data.start.customParameters.callerId;
                openAIService.callerId = callerId;
            }
            if (data.start.customParameters.mode) {
                mode = data.start.customParameters.mode;
                openAIService.mode = mode;
                import('../config/prompts.js').then((prompts) => {
                    openAIService.instructions = mode === 'outbound' ? prompts.SARAH_OUTBOUND : prompts.SARAH_INBOUND;
                });
            }
        }

        openAIService.callSid = callSid;
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
    logger.info(`WebSocket connection closed for call ${callSid}`);
    if (openAIService.openaiWs) {
        openAIService.openaiWs.close();
    }
  });
};
