import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = (req, reply) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();

    // Default to inbound
    const callerId = req.body?.From || 'unknown';

    const stream = connect.stream({
      url: `wss://${req.headers.host}/voice/stream`,
    });

    stream.parameter({ name: 'callerId', value: callerId });
    stream.parameter({ name: 'mode', value: 'inbound' });

    reply.type('text/xml');
    return reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    return reply.code(500).send('Internal Server Error');
  }
};

export const outboundCall = (req, reply) => {
    try {
        logger.info('Handling outbound call TwiML request');
        const callerId = req.query.callerId || 'unknown';
        const response = new VoiceResponse();
        const connect = response.connect();

        const stream = connect.stream({
            url: `wss://${req.headers.host}/voice/stream`,
        });

        stream.parameter({ name: 'callerId', value: callerId });
        stream.parameter({ name: 'mode', value: 'outbound' });

        reply.type('text/xml');
        return reply.send(response.toString());
    } catch (error) {
        logger.error('Error handling outbound call:', error);
        return reply.code(500).send('Internal Server Error');
    }
};

export const callStatus = async (req, reply) => {
    try {
        const callSid = req.body?.CallSid;
        const status = req.body?.CallStatus;

        logger.info(`Call status update for ${callSid}: ${status}`);

        if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(status)) {
            // Dynamically import markCallEnded to avoid circular dependencies if any
            const { markCallEnded } = await import('../services/dripService.js');
            markCallEnded(callSid);
        }

        return reply.code(200).send('OK');
    } catch (error) {
        logger.error('Error handling call status:', error);
        return reply.code(500).send('Internal Server Error');
    }
};

export const handleWebSocket = (connection, req) => {
  logger.info('New WebSocket connection');

  // Fastify v11 exposes socket on connection.socket
  const ws = connection.socket ? connection.socket : connection;

  let callSid = 'unknown';
  let openAIService = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;
        const customParams = data.start.customParameters || {};
        const callerId = customParams.callerId || 'unknown';
        const mode = customParams.mode || 'inbound';

        logger.info(`Stream started for CallSid: ${callSid}, Mode: ${mode}, CallerId: ${callerId}`);

        openAIService = new OpenAIRealtimeService(ws, callSid, callerId, mode);
        openAIService.connect();

        openAIService.handleTwilioMedia(data);
      } else if (data.event === 'media') {
        if (openAIService) {
            openAIService.handleTwilioMedia(data);
        }
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

    // Ensure Smart Drip lock is released if WS closes abruptly
    try {
        const { markCallEnded } = await import('../services/dripService.js');
        markCallEnded(callSid);
    } catch(e) {
        logger.error('Error releasing lock on WS close', e);
    }
  });
};
