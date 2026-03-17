import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import { markCallEnded } from '../services/dripService.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = (request, reply) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();

    // Pass callerId and mode inbound as custom parameters
    const stream = connect.stream({
      url: `wss://${request.headers.host}/voice/stream`,
    });

    stream.parameter({
      name: 'callerId',
      value: request.body.From || 'unknown'
    });

    stream.parameter({
      name: 'mode',
      value: 'inbound'
    });

    reply.type('text/xml');
    reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.code(500).send('Internal Server Error');
  }
};

export const statusCallback = (request, reply) => {
  try {
    const { CallSid, CallStatus } = request.body;
    logger.info(`Received status callback for call ${CallSid}: ${CallStatus}`);

    // Call might have ended, let Drip Service know to unlock
    if (CallStatus === 'completed' || CallStatus === 'failed' || CallStatus === 'busy' || CallStatus === 'no-answer' || CallStatus === 'canceled') {
       markCallEnded(CallSid);
    }

    reply.code(200).send('OK');
  } catch (error) {
    logger.error('Error handling status callback:', error);
    reply.code(500).send('Internal Server Error');
  }
};

export const handleWebSocket = (connection, req) => {
  logger.info('New WebSocket connection');

  // We need to wait for the Twilio start event to get the proper parameters
  let callSid = 'unknown';
  let callerId = 'unknown';
  let mode = 'inbound'; // Default to inbound

  // The service is instantiated, but needs to wait for 'start' to fully configure
  const openAIService = new OpenAIRealtimeService(connection, callSid, callerId, mode);
  openAIService.connect();

  connection.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;

        // Extract custom parameters if available
        if (data.start.customParameters) {
            callerId = data.start.customParameters.callerId || 'unknown';
            mode = data.start.customParameters.mode || 'inbound';
        }

        // Update service instance variables
        openAIService.callSid = callSid;
        openAIService.callerId = callerId;
        openAIService.mode = mode;

        logger.info(`Stream start event: CallSid=${callSid}, CallerId=${callerId}, Mode=${mode}`);
        openAIService.handleTwilioMedia(data);
      } else if (data.event === 'media') {
        openAIService.handleTwilioMedia(data);
      } else if (data.event === 'stop') {
        logger.info(`Stream stopped for call ${callSid}`);
        connection.close();
      }
    } catch (error) {
      logger.error('Error processing WebSocket message:', error);
    }
  });

  connection.on('close', () => {
    logger.info('WebSocket connection closed');
    if (openAIService.openaiWs) {
        openAIService.openaiWs.close();
    }
  });
};
