import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = async (request, reply) => {
  try {
    const callerId = request.query?.callerId || request.body?.From || 'unknown';
    const mode = request.query?.mode || 'inbound';

    logger.info(`Incoming call received from ${callerId} (Mode: ${mode})`);

    const response = new VoiceResponse();
    const connect = response.connect();

    const streamUrl = `wss://${request.headers.host}/voice/stream`;
    const streamParams = { url: streamUrl };

    const stream = connect.stream(streamParams);
    stream.parameter({ name: 'callerId', value: callerId });
    stream.parameter({ name: 'mode', value: mode });

    reply.type('text/xml');
    return reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    return reply.code(500).send('Internal Server Error');
  }
};

export const inboundStatus = async (request, reply) => {
  try {
    const callStatus = request.body?.CallStatus;
    const callSid = request.body?.CallSid;
    logger.info(`Call status update received: ${callSid} is ${callStatus}`);

    const terminalStatuses = ['completed', 'busy', 'failed', 'no-answer', 'canceled'];
    if (terminalStatuses.includes(callStatus)) {
        const { releaseCallLock } = await import('../services/dripService.js');
        releaseCallLock(callSid);
    }

    return reply.send('OK');
  } catch (error) {
    logger.error('Error handling call status:', error);
    return reply.code(500).send('Internal Server Error');
  }
};

export const handleWebSocket = (connection, req) => {
  logger.info('New WebSocket connection');

  const ws = connection.socket ? connection.socket : connection;

  let callSid = 'unknown';
  let callerId = 'unknown';
  let mode = 'inbound';

  const openAIService = new OpenAIRealtimeService(ws, callSid, callerId, mode);
  openAIService.connect();

  ws.on('message', async (message) => {
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

        try {
            const { releaseCallLock } = await import('../services/dripService.js');
            releaseCallLock(callSid);
        } catch (e) {
            logger.error('Error releasing lock on stream stop:', e);
        }

        ws.close();
      }
    } catch (error) {
      logger.error('Error processing WebSocket message:', error);
    }
  });

  ws.on('close', async () => {
    logger.info(`WebSocket connection closed for call ${callSid}`);

    try {
        const { releaseCallLock } = await import('../services/dripService.js');
        releaseCallLock(callSid);
    } catch (e) {
        logger.error('Error releasing lock on socket close:', e);
    }

    if (openAIService.openaiWs && openAIService.openaiWs.readyState === 1) {
        openAIService.openaiWs.close();
    }
  });
};
