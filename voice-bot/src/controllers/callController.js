import twilio from 'twilio';
import logger from '../utils/logger.js';
import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import { markCallEnded } from '../services/dripService.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = async (req, reply) => {
  try {
    logger.info('Incoming inbound call received');
    const response = new VoiceResponse();
    const connect = response.connect();

    // Absolute WSS path
    const stream = connect.stream({
      url: `wss://${req.headers.host}/voice/stream`,
    });

    stream.parameter({
      name: 'callerId',
      value: req.body?.From || 'unknown'
    });
    stream.parameter({
      name: 'mode',
      value: 'inbound'
    });

    return reply.type('text/xml').send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    return reply.status(500).send('Internal Server Error');
  }
};

export const outboundCall = async (req, reply) => {
  try {
    const callerId = req.query.callerId || 'unknown';
    logger.info(`Outbound call connected for callerId: ${callerId}`);

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

    return reply.type('text/xml').send(response.toString());
  } catch (error) {
    logger.error('Error handling outbound call:', error);
    return reply.status(500).send('Internal Server Error');
  }
};

export const outboundStatus = async (req, reply) => {
  try {
    const status = req.body?.CallStatus;
    const callSid = req.body?.CallSid;

    logger.info(`Status callback received: ${status} for CallSid: ${callSid}`);

    if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(status)) {
      markCallEnded(callSid);
    }

    return reply.status(200).send('OK');
  } catch (error) {
    logger.error('Error handling status callback:', error);
    return reply.status(500).send('Internal Server Error');
  }
};

export const handleWebSocket = (ws, req) => {
  logger.info('New WebSocket connection established');

  let callSid = 'unknown';
  let callerId = 'unknown';

  const openAIService = new OpenAIRealtimeService(ws);
  openAIService.connect();

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;

        // Extract custom parameters
        const customParams = data.start.customParameters;
        if (customParams) {
          callerId = customParams.callerId || 'unknown';
        }

        openAIService.callSid = callSid;
        openAIService.callerId = callerId;

        // Notify openai service that twilio is connected
        openAIService.handleTwilioStart(data);

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
    logger.info(`WebSocket connection closed for call ${callSid}`);

    // Dynamically import markCallEnded to prevent deadlocks
    const { markCallEnded } = await import('../services/dripService.js');
    markCallEnded(callSid);

    if (openAIService.openaiWs) {
        openAIService.openaiWs.close();
    }
  });
};