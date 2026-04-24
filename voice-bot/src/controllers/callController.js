import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = async (req, reply) => {
  try {
    logger.info('Incoming call received');
    const callerId = req.body?.From || 'unknown';
    const mode = 'inbound';

    const response = new VoiceResponse();
    const connect = response.connect();
    const stream = connect.stream({
      url: `wss://${req.headers.host}/voice/stream`,
    });

    stream.parameter({ name: 'callerId', value: callerId });
    stream.parameter({ name: 'mode', value: mode });

    reply.type('text/xml');
    return reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    return reply.code(500).send('Internal Server Error');
  }
};

export const inboundStatus = async (req, reply) => {
  try {
    const callStatus = req.body?.CallStatus;
    const callSid = req.body?.CallSid;

    if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(callStatus)) {
        const { markCallEnded } = await import('../services/dripService.js');
        await markCallEnded(callSid);
    }

    return reply.code(200).send('OK');
  } catch (error) {
    logger.error('Error handling inbound status:', error);
    return reply.code(500).send('Internal Server Error');
  }
}

export const handleWebSocket = (ws, req) => {
  logger.info('New WebSocket connection');

  let callSid = 'unknown';
  let openAIService = null;

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;
        const customParameters = data.start.customParameters || {};
        const callerId = customParameters.callerId || 'unknown';
        const mode = customParameters.mode || 'outbound';

        openAIService = new OpenAIRealtimeService(ws, callSid, callerId, mode);
        openAIService.connect();

        openAIService.callSid = callSid;
        openAIService.handleTwilioMedia(data);
      } else if (data.event === 'media' && openAIService) {
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
    if (openAIService && openAIService.openaiWs) {
        openAIService.openaiWs.close();
    }

    try {
        const { markCallEnded } = await import('../services/dripService.js');
        await markCallEnded(callSid);
    } catch (err) {
        logger.error('Error calling markCallEnded on WS close', err);
    }
  });
};
