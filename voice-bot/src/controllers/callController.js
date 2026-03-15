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
    const callerId = request.body?.From || 'unknown';

    const stream = connect.stream({
      url: `wss://${request.headers.host}/voice/stream`,
    });

    stream.parameter({ name: 'callerId', value: callerId });
    stream.parameter({ name: 'mode', value: 'inbound' });

    reply.type('text/xml');
    reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const statusCallback = async (request, reply) => {
  try {
    const { CallSid, CallStatus } = request.body || {};
    logger.info(`Status callback for call ${CallSid}: ${CallStatus}`);

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

  connection.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;

        // Extract callerId and mode from stream custom parameters
        const customParams = data.start.customParameters || {};
        const callerId = customParams.callerId || 'unknown';
        const mode = customParams.mode || 'inbound';

        logger.info(`Stream started for call ${callSid} with mode ${mode} and callerId ${callerId}`);
        openAIService = new OpenAIRealtimeService(connection, callSid, callerId, mode);
        openAIService.connect();

        // Pass the start event to openai realtime service to capture streamSid
        openAIService.handleTwilioMedia(data);

      } else if (data.event === 'media') {
        if (openAIService) {
          openAIService.handleTwilioMedia(data);
        }
      } else if (data.event === 'stop') {
        logger.info(`Stream stopped for call ${callSid}`);
        if (openAIService && openAIService.openaiWs) {
          openAIService.openaiWs.close();
        }
        connection.close();
      }
    } catch (error) {
      logger.error('Error processing WebSocket message:', error);
    }
  });

  connection.on('close', () => {
    logger.info(`WebSocket connection closed for call ${callSid}`);
    if (openAIService && openAIService.openaiWs) {
        openAIService.openaiWs.close();
    }
  });
};
