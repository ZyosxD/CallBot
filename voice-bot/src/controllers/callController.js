import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

const extractCallerId = (request) => {
    return request.query?.callerId || request.body?.From || 'unknown';
};

export const inboundCall = (req, reply) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();

    // Pass mode=inbound
    connect.stream({
      url: `wss://${req.headers.host}/voice/stream?mode=inbound`,
    });

    reply.type('text/xml').send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const outboundCall = (req, reply) => {
  try {
    logger.info('Outbound TwiML requested');
    const callerId = extractCallerId(req);
    const response = new VoiceResponse();
    const connect = response.connect();

    // Pass mode=outbound
    connect.stream({
      url: `wss://${req.headers.host}/voice/stream?mode=outbound&callerId=${encodeURIComponent(callerId)}`,
    });

    reply.type('text/xml').send(response.toString());
  } catch (error) {
    logger.error('Error handling outbound call:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const inboundStatus = async (req, reply) => {
    const status = req.body?.CallStatus;
    const callSid = req.body?.CallSid;

    logger.info(`Call Status Update: ${callSid} -> ${status}`);

    if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(status)) {
        try {
            const { markCallEnded } = await import('../services/dripService.js');
            markCallEnded(callSid);
        } catch (error) {
            logger.error('Error dynamically importing markCallEnded:', error);
        }
    }

    reply.status(200).send('OK');
};

export const handleWebSocket = (connection, req) => {
  const ws = connection.socket ? connection.socket : connection;
  logger.info('New WebSocket connection');

  const mode = req.query?.mode || 'inbound';
  const callerId = req.query?.callerId || 'unknown';
  let callSid = 'unknown';

  const openAIService = new OpenAIRealtimeService(ws, callSid, mode, callerId);
  openAIService.connect();

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;
        openAIService.callSid = callSid;
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

    try {
        const { markCallEnded } = await import('../services/dripService.js');
        markCallEnded(callSid);
    } catch (error) {
        logger.error('Error dynamically importing markCallEnded:', error);
    }
  });
};
