import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { markCallEnded } from '../services/dripService.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = (req, reply) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();

    const callerId = (req.body && req.body.From) ? req.body.From : 'unknown';

    const stream = connect.stream({
      url: `wss://${req.headers.host}/voice/stream`,
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

export const statusCallback = (req, reply) => {
  try {
    const callStatus = req.body.CallStatus;
    const callSid = req.body.CallSid;

    if (callStatus === 'completed' || callStatus === 'failed' || callStatus === 'busy' || callStatus === 'no-answer' || callStatus === 'canceled') {
       logger.info(`Call ${callSid} status: ${callStatus}`);
       markCallEnded(callSid);
    }

    reply.send('OK');
  } catch (error) {
    logger.error('Error handling status callback:', error);
    reply.status(500).send('Error');
  }
};

export const handleWebSocket = (connection, req) => {
  logger.info('New WebSocket connection');

  const ws = connection;

  let callSid = 'unknown';
  let callerId = 'unknown';
  let mode = 'inbound';

  let openAIService = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;

        if (data.start.customParameters) {
            callerId = data.start.customParameters.callerId || 'unknown';
            mode = data.start.customParameters.mode || 'inbound';
        }

        logger.info(`Stream started for callSid: ${callSid}, callerId: ${callerId}, mode: ${mode}`);

        openAIService = new OpenAIRealtimeService(ws, callSid, callerId, mode);
        openAIService.connect();
        openAIService.handleTwilioMedia(data);

      } else if (data.event === 'media' && openAIService) {
        openAIService.handleTwilioMedia(data);
      } else if (data.event === 'stop') {
        logger.info(`Stream stopped for call ${callSid}`);
        if (openAIService) {
            openAIService.close();
        }
        ws.close();
      }
    } catch (error) {
      logger.error('Error processing WebSocket message:', error);
    }
  });

  ws.on('close', () => {
    logger.info('WebSocket connection closed');
    if (openAIService) {
        openAIService.close();
    }
  });
};
