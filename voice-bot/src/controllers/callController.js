import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { releaseCallLock } from '../services/dripService.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = async (request, reply) => {
  try {
    logger.info('Incoming call received');
    const callerId = request.body.From || 'Unknown';
    const response = new VoiceResponse();
    const connect = response.connect();
    const stream = connect.stream({
      url: `wss://${request.headers.host}/voice/stream`,
    });
    stream.parameter({ name: 'mode', value: 'inbound' });
    stream.parameter({ name: 'callerId', value: callerId });

    reply.type('text/xml').send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const handleWebSocket = (connection, request) => {
  logger.info('New WebSocket connection');

  let callSid = 'unknown';
  let callerId = 'unknown';
  let mode = 'inbound';

  // Note: For Fastify, connection.socket provides the underlying ws
  const openAIService = new OpenAIRealtimeService(connection.socket, callSid, callerId, mode);
  openAIService.connect();

  connection.socket.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;

        // Extract custom parameters
        const customParams = data.start.customParameters || {};
        callerId = customParams.callerId || 'unknown';
        mode = customParams.mode || 'inbound';

        openAIService.callSid = callSid;
        openAIService.callerId = callerId;
        openAIService.mode = mode;

        logger.info(`Stream started for call ${callSid} | Mode: ${mode} | Caller: ${callerId}`);
        openAIService.handleTwilioMedia(data);
      } else if (data.event === 'media') {
        openAIService.handleTwilioMedia(data);
      } else if (data.event === 'stop') {
        logger.info(`Stream stopped for call ${callSid}`);
        connection.socket.close();
      }
    } catch (error) {
      logger.error('Error processing WebSocket message:', error);
    }
  });

  connection.socket.on('close', () => {
    logger.info(`WebSocket connection closed for call ${callSid}`);
    if (openAIService.openaiWs) {
      openAIService.openaiWs.close();
    }
  });
};

export const statusCallback = async (request, reply) => {
  const callStatus = request.body.CallStatus;
  const callSid = request.body.CallSid;

  logger.info(`Call Status Update - Sid: ${callSid}, Status: ${callStatus}`);

  if (['completed', 'failed', 'busy', 'no-answer', 'canceled'].includes(callStatus)) {
    logger.info('Call ended or failed, releasing lock.');
    releaseCallLock();
  }

  reply.send({ status: 'received' });
};
