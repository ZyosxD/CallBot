import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = (request, reply) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();

    const host = request.headers.host;
    const stream = connect.stream({
      url: `wss://${host}/voice/stream`,
    });

    stream.parameter({ name: 'mode', value: 'inbound' });
    const fromNumber = request.body?.From || 'unknown';
    stream.parameter({ name: 'callerId', value: fromNumber });

    reply.type('text/xml').send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.code(500).send('Internal Server Error');
  }
};

export const outboundCall = (request, reply) => {
  try {
    logger.info('Outbound call answered by Twilio');
    const response = new VoiceResponse();
    const connect = response.connect();

    const host = request.headers.host;
    const callerId = request.query?.callerId || 'unknown';

    const stream = connect.stream({
      url: `wss://${host}/voice/stream`,
    });

    stream.parameter({ name: 'mode', value: 'outbound' });
    stream.parameter({ name: 'callerId', value: callerId });

    reply.type('text/xml').send(response.toString());
  } catch (error) {
    logger.error('Error handling outbound call:', error);
    reply.code(500).send('Internal Server Error');
  }
};

export const inboundStatus = async (request, reply) => {
  try {
    const callStatus = request.body?.CallStatus;
    const callSid = request.body?.CallSid;

    logger.info(`Call status update for ${callSid}: ${callStatus}`);

    if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(callStatus)) {
      const { markCallEnded } = await import('../services/dripService.js');
      markCallEnded(callSid);
    }

    reply.code(200).send('OK');
  } catch (error) {
    logger.error('Error handling inbound status:', error);
    reply.code(500).send('Internal Server Error');
  }
};

export const handleWebSocket = (connection, request) => {
  const ws = connection.socket ? connection.socket : connection;
  logger.info('New WebSocket connection');

  let callSid = 'unknown';
  let mode = 'inbound';
  let callerId = 'unknown';
  let openAIService = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;

        // Extract custom parameters sent from TwiML
        if (data.start.customParameters) {
          mode = data.start.customParameters.mode || 'inbound';
          callerId = data.start.customParameters.callerId || 'unknown';
        }

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

    try {
      const { markCallEnded } = await import('../services/dripService.js');
      markCallEnded(callSid);
    } catch (error) {
      logger.error('Error marking call ended on ws close:', error);
    }
  });
};
