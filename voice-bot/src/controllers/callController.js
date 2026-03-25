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

    // Pass callerId and mode as custom parameters
    const callerId = (request.body && request.body.From) ? request.body.From : 'unknown';
    const stream = connect.stream({
      url: `wss://${request.headers.host}/voice/stream`,
    });

    stream.parameter({
      name: 'mode',
      value: 'inbound'
    });
    stream.parameter({
      name: 'callerId',
      value: callerId
    });

    reply.header('Content-Type', 'text/xml');
    reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const handleStatusCallback = (request, reply) => {
  try {
    const callSid = request.body.CallSid;
    const callStatus = request.body.CallStatus;

    logger.info(`Status callback for CallSid ${callSid}: ${callStatus}`);

    // Release the concurrency lock if call is completed, failed, busy, or no-answer
    if (['completed', 'failed', 'busy', 'no-answer', 'canceled'].includes(callStatus)) {
      markCallEnded(callSid);
    }

    reply.status(200).send('OK');
  } catch (error) {
    logger.error('Error handling status callback:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const handleWebSocket = (connection, req) => {
  const ws = connection;
  logger.info('New WebSocket connection');

  let callSid = 'unknown';
  let callerId = 'unknown';
  let mode = 'inbound';

  // We don't have these details yet; they come in the "start" message
  const openAIService = new OpenAIRealtimeService(ws, callSid, callerId, mode);
  openAIService.connect();

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;

        // Extract custom parameters sent from Twilio
        if (data.start.customParameters) {
          callerId = data.start.customParameters.callerId || 'unknown';
          mode = data.start.customParameters.mode || 'inbound';
        }

        openAIService.callSid = callSid;
        openAIService.callerId = callerId;
        openAIService.mode = mode;
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
