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

export const inboundStatus = async (request, reply) => {
  const { CallStatus, CallSid } = request.body || {};
  logger.info(`Inbound call status update: ${CallStatus} for SID: ${CallSid}`);

  if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(CallStatus)) {
    // Dynamic import to avoid circular dependency issues
    import('../services/dripService.js').then(module => {
      module.markCallEnded(CallSid);
    }).catch(err => {
      logger.error('Error importing dripService dynamically for inboundStatus', err);
    });
  }

  reply.status(200).send('OK');
};

export const handleWebSocket = (connection, request) => {
  logger.info('New WebSocket connection');

  // Extract socket from connection for Fastify v11
  const ws = connection.socket ? connection.socket : connection;

  let callSid = 'unknown';
  let mode = 'inbound';
  let callerId = 'unknown';
  let openAIService = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;

        // Extract parameters passed from TwiML
        const customParams = data.start.customParameters || {};
        mode = customParams.mode || 'inbound';
        callerId = customParams.callerId || 'unknown';

        logger.info(`Stream started for call ${callSid} in ${mode} mode with callerId ${callerId}`);

        openAIService = new OpenAIRealtimeService(ws, callSid, mode, callerId);
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
    logger.info(`WebSocket connection closed for call ${callSid}`);

    // Dynamically import markCallEnded to avoid circular dependencies
    import('../services/dripService.js').then(module => {
      module.markCallEnded(callSid);
    }).catch(err => {
      logger.error('Error dynamically importing dripService on ws close', err);
    });

    if (openAIService && openAIService.openaiWs) {
        openAIService.openaiWs.close();
    }
  });
};
