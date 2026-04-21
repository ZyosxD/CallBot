import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = async (request, reply) => {
  try {
    logger.info('Incoming call received');
    const callerId = request.body?.From || 'unknown';
    const response = new VoiceResponse();
    const connect = response.connect();

    // Inject parameters for inbound calls
    const stream = connect.stream({
      url: `wss://${request.headers.host}/voice/stream`,
    });
    stream.parameter({ name: 'mode', value: 'inbound' });
    stream.parameter({ name: 'callerId', value: callerId });

    reply.type('text/xml').send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const outboundCallTwiML = async (request, reply) => {
  try {
    const callerId = request.query.callerId || 'unknown';
    logger.info(`Generating outbound TwiML for ${callerId}`);

    const response = new VoiceResponse();
    const connect = response.connect();

    // Inject parameters for outbound calls
    const stream = connect.stream({
      url: `wss://${request.headers.host}/voice/stream`,
    });
    stream.parameter({ name: 'mode', value: 'outbound' });
    stream.parameter({ name: 'callerId', value: callerId });

    reply.type('text/xml').send(response.toString());
  } catch (error) {
    logger.error('Error handling outbound call TwiML:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const inboundStatus = async (request, reply) => {
  const callSid = request.body?.CallSid;
  const status = request.body?.CallStatus;

  logger.info(`Call Status Update: ${callSid} -> ${status}`);

  if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(status)) {
    try {
      const { markCallEnded } = await import('../services/dripService.js');
      markCallEnded(callSid);
    } catch (e) {
      logger.error('Failed to import and call markCallEnded', e);
    }
  }
  reply.send('OK');
};

export const handleWebSocket = (ws, req) => {
  logger.info('New WebSocket connection');

  let callSid = 'unknown';
  let mode = 'inbound';
  let callerId = 'unknown';

  const openAIService = new OpenAIRealtimeService(ws, callSid);
  openAIService.connect();

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;

        // Extract custom parameters injected by TwiML
        const params = data.start.customParameters || {};
        mode = params.mode || 'inbound';
        callerId = params.callerId || 'unknown';

        openAIService.callSid = callSid;
        openAIService.mode = mode;
        openAIService.callerId = callerId;

        logger.info(`Stream started: CallSid=${callSid}, Mode=${mode}, CallerId=${callerId}`);
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

    // Dynamically release the outbound dialing lock
    try {
      const { markCallEnded } = await import('../services/dripService.js');
      markCallEnded(callSid);
    } catch (e) {
      logger.error('Failed to import and call markCallEnded on close', e);
    }
  });
};
