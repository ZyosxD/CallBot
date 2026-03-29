import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = async (req, reply) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();

    // Mode 'inbound' will trigger Receptionist behavior, Mode 'outbound' for Cold Caller
    const mode = 'inbound';

    // Safely retrieve callerId from from field
    const callerId = (req.body && req.body.From) ? req.body.From : 'unknown';

    const stream = connect.stream({
      url: `wss://${req.headers.host}/voice/stream`,
    });

    // We send mode and callerId as parameters so we can capture them inside the WebSocket connection
    stream.parameter({ name: 'mode', value: mode });
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
  let mode = 'inbound';

  // We don't initialize OpenAI yet until we get the start parameters.
  let openAIService = null;

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;

        // Extract parameters from the TwiML stream
        if (data.start.customParameters) {
          if (data.start.customParameters.mode) {
             mode = data.start.customParameters.mode;
          }
          if (data.start.customParameters.callerId) {
             callerId = data.start.customParameters.callerId;
          }
        }

        logger.info(`Stream started for call ${callSid} (mode: ${mode}, caller: ${callerId})`);

        // Initialize and connect
        openAIService = new OpenAIRealtimeService(ws, callSid, callerId, mode);
        await openAIService.connect();
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

    // Attempt dynamic import to mark call ended and release locks if needed.
    import('../services/dripService.js').then(({ markCallEnded }) => {
       if (callSid !== 'unknown') {
         markCallEnded(callSid);
       }
    }).catch(e => logger.error("Error dynamically importing drip service on close", e));
  });
};
