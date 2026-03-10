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

    const host = request.headers.host;
    const callerId = request.body.From;

    const stream = connect.stream({
      url: `wss://${host}/voice/stream`,
    });

    stream.parameter({
      name: 'callerId',
      value: callerId
    });

    stream.parameter({
      name: 'mode',
      value: 'inbound'
    });

    reply.type('text/xml');
    return response.toString();
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const handleStatusCallback = async (request, reply) => {
    try {
        const { CallSid, CallStatus } = request.body;
        logger.info(`Received call status callback for CallSid: ${CallSid}, Status: ${CallStatus}`);

        if (CallStatus === 'completed' || CallStatus === 'failed' || CallStatus === 'canceled' || CallStatus === 'no-answer' || CallStatus === 'busy') {
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
  const ws = connection;

  let callSid = 'unknown';
  let callerId = 'unknown';
  let mode = 'inbound'; // default, will be overridden by start event CustomParameters

  const openAIService = new OpenAIRealtimeService(ws, callSid, callerId, mode);
  openAIService.connect();

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;
        openAIService.callSid = callSid;

        if (data.start.customParameters) {
            if (data.start.customParameters.callerId) {
                callerId = data.start.customParameters.callerId;
                openAIService.callerId = callerId;
            }
            if (data.start.customParameters.mode) {
                mode = data.start.customParameters.mode;
                openAIService.mode = mode;
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

  ws.on('close', () => {
    logger.info('WebSocket connection closed');
    if (openAIService.openaiWs) {
        openAIService.openaiWs.close();
    }
  });
};
