import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = (request, reply) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();

    // mode=inbound indicates SARAH_INBOUND (receptionist)
    const stream = connect.stream({
      url: `wss://${request.headers.host}/voice/stream`,
    });
    stream.parameter({
      name: 'mode',
      value: 'inbound'
    });
    stream.parameter({
      name: 'callerId',
      value: request.body?.From || 'unknown'
    });

    reply.type('text/xml');
    reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const inboundStatus = async (request, reply) => {
  try {
    const status = request.body?.CallStatus;
    const callSid = request.body?.CallSid;

    logger.info(`Call status update for ${callSid}: ${status}`);

    // Terminal states that release the outbound lock
    if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(status)) {
      // Dynamic import to prevent circular dependency
      const { markCallEnded } = await import('../services/dripService.js');
      markCallEnded(callSid);
    }

    reply.status(200).send();
  } catch (error) {
    logger.error('Error handling status callback:', error);
    reply.status(500).send();
  }
};

export const handleWebSocket = (connection, request) => {
  const ws = connection.socket ? connection.socket : connection;
  logger.info('New WebSocket connection');

  let callSid = 'unknown';
  // Extract callerId from optional query parameters or body (if available)
  const callerId = request.query?.callerId || request.body?.From || 'unknown';

  // Create openAI service instance
  const openAIService = new OpenAIRealtimeService(ws, callSid, callerId);
  openAIService.connect();

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;
        openAIService.callSid = callSid;

        // Extract mode and callerId from custom parameters if sent via TwiML
        if (data.start.customParameters) {
          if (data.start.customParameters.mode) {
            openAIService.mode = data.start.customParameters.mode;
          }
          if (data.start.customParameters.callerId && data.start.customParameters.callerId !== 'unknown') {
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

  ws.on('close', async () => {
    logger.info('WebSocket connection closed');
    if (openAIService.openaiWs) {
        openAIService.openaiWs.close();
    }
    // Dynamic import to forcefully release lock if the socket closes
    try {
      const { markCallEnded } = await import('../services/dripService.js');
      markCallEnded(callSid);
    } catch (err) {
      logger.error('Failed to import or call markCallEnded on close:', err);
    }
  });
};
