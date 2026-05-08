import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = async (request, reply) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();

    // For outbound calls from dripService, Direction is usually 'outbound-api'
    const isOutbound = request.body?.Direction === 'outbound-api';
    const mode = isOutbound ? 'outbound' : 'inbound';
    // For outbound, the client we are calling is in the 'To' field
    // For inbound, the client calling us is in the 'From' field
    const callerId = isOutbound ? request.body?.To : request.body?.From;

    const stream = connect.stream({
      url: `wss://${request.headers.host}/voice/stream`,
    });

    // We must NOT chain .parameter()
    stream.parameter({
      name: 'callerId',
      value: callerId || 'unknown'
    });

    stream.parameter({
      name: 'mode',
      value: mode
    });

    reply.header('Content-Type', 'text/xml');
    return reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const inboundStatus = async (request, reply) => {
  try {
    const callSid = request.body?.CallSid;
    const callStatus = request.body?.CallStatus;

    logger.info(`Call Status Update - SID: ${callSid}, Status: ${callStatus}`);

    if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(callStatus)) {
      // Release the drip engine lock dynamically
      const { markCallEnded } = await import('../services/dripService.js');
      markCallEnded(callSid);
    }

    return reply.status(200).send('OK');
  } catch (error) {
    logger.error('Error handling inbound status:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const handleWebSocket = (ws, request) => {
  logger.info('New WebSocket connection');

  let callSid = 'unknown';

  const openAIService = new OpenAIRealtimeService(ws, callSid);
  openAIService.connect();

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;
        openAIService.callSid = callSid;

        // Extract callerId and mode from stream parameters if they exist
        const callerId = data.start.customParameters?.callerId || 'unknown';
        const mode = data.start.customParameters?.mode || 'inbound';
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

  ws.on('close', async () => {
    logger.info('WebSocket connection closed');
    if (openAIService.openaiWs) {
        openAIService.openaiWs.close();
    }
    // dynamically import markCallEnded to forcefully release the dialing lock when calls disconnect
    const { markCallEnded } = await import('../services/dripService.js');
    markCallEnded(callSid);
  });
};
