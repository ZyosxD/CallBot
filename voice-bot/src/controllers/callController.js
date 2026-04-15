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

    const stream = connect.stream({
      url: `wss://${req.headers.host}/voice/stream`,
    });

    const callerId = req.body?.From || 'unknown';

    stream.parameter({
      name: 'callerId',
      value: callerId
    });

    stream.parameter({
      name: 'mode',
      value: 'inbound'
    });

    reply.type('text/xml').send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const outboundTwiml = async (req, reply) => {
  try {
    const callerId = req.query.callerId || 'unknown';
    logger.info(`Generating outbound TwiML for ${callerId}`);
    const response = new VoiceResponse();
    const connect = response.connect();

    const stream = connect.stream({
      url: `wss://${req.headers.host}/voice/stream`,
    });

    stream.parameter({
      name: 'callerId',
      value: callerId
    });

    stream.parameter({
      name: 'mode',
      value: 'outbound'
    });

    reply.type('text/xml').send(response.toString());
  } catch (error) {
    logger.error('Error handling outbound twiml:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const handleStatusCallback = async (req, reply) => {
  try {
    const callStatus = req.body?.CallStatus;
    const callSid = req.body?.CallSid;
    logger.info(`Call status update: ${callSid} is ${callStatus}`);

    if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(callStatus)) {
      const { markCallEnded } = await import('../services/dripService.js');
      markCallEnded(callSid);
    }

    reply.send('OK');
  } catch (error) {
    logger.error('Error handling status callback:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const handleWebSocket = (ws, req) => {
  logger.info('New WebSocket connection');

  let callSid = 'unknown';
  let callerId = 'unknown';
  let mode = 'inbound';

  const openAIService = new OpenAIRealtimeService(ws, callSid);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;

        if (data.start.customParameters) {
          callerId = data.start.customParameters.callerId || callerId;
          mode = data.start.customParameters.mode || mode;
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

  ws.on('close', async () => {
    logger.info('WebSocket connection closed');
    if (openAIService.openaiWs) {
        openAIService.openaiWs.close();
    }
    const { markCallEnded } = await import('../services/dripService.js');
    markCallEnded(callSid);
  });
};