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
    const stream = connect.stream({
      url: `wss://${request.headers.host}/voice/stream`,
    });

    const body = request.body || {};
    const isOutbound = body.Direction === 'outbound-api';
    const callerId = isOutbound ? body.To : body.From;
    const mode = isOutbound ? 'outbound' : 'inbound';

    if (callerId) {
      stream.parameter({ name: 'callerId', value: callerId });
    }
    stream.parameter({ name: 'mode', value: mode });

    reply.type('text/xml');
    reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.code(500).send('Internal Server Error');
  }
};

export const inboundStatus = async (request, reply) => {
  try {
    const body = request.body || {};
    const callSid = body.CallSid;
    const callStatus = body.CallStatus;

    if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(callStatus)) {
      if (callSid) {
        import('../services/dripService.js').then((module) => {
           module.markCallEnded(callSid);
        });
      }
    }
    reply.code(200).send('OK');
  } catch (error) {
    logger.error('Error handling inbound status:', error);
    reply.code(500).send('Internal Server Error');
  }
};

export const handleWebSocket = (connection, request) => {
  logger.info('New WebSocket connection');

  const ws = connection.socket ? connection.socket : connection;

  let callSid = 'unknown';

  const openAIService = new OpenAIRealtimeService(ws, callSid);
  openAIService.connect();

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());

      if (data.event === 'start') {
        callSid = data.start.callSid;
        openAIService.callSid = callSid;

        const customParams = data.start.customParameters || {};
        openAIService.callerId = customParams.callerId || 'unknown';
        openAIService.mode = customParams.mode || 'inbound';

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
    import('../services/dripService.js').then((module) => {
       module.markCallEnded(callSid);
    });
  });
};