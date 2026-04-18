import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = async (req, reply) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();

    // Support using public URL for websocket if provided
    const protocol = config.server.publicUrl?.startsWith('https') ? 'wss' : 'ws';
    const host = config.server.publicUrl?.replace(/^https?:\/\//, '') || req.headers.host;
    const streamUrl = `${protocol}://${host}/voice/stream`;

    const connect = response.connect();
    const stream = connect.stream({ url: streamUrl });

    // Add parameters for mode and callerId for inbound calls
    stream.parameter({ name: 'mode', value: 'inbound' });
    stream.parameter({ name: 'callerId', value: req.body?.From || 'unknown' });

    return reply.type('text/xml').send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    return reply.code(500).send('Internal Server Error');
  }
};

export const inboundStatus = async (req, reply) => {
  const { CallSid, CallStatus } = req.body;
  logger.info(`Call ${CallSid} status update: ${CallStatus}`);

  if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(CallStatus.toLowerCase())) {
    try {
      const { markCallEnded } = await import('../services/dripService.js');
      markCallEnded(CallSid);
    } catch (err) {
      logger.error('Error importing/calling markCallEnded: ' + err.message);
    }
  }

  return reply.code(200).send('OK');
};

export const handleWebSocket = (ws, req) => {
  logger.info('New WebSocket connection');

  let callSid = 'unknown';
  let openAIService = null;

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;

        // Extract parameters from TwiML
        const customParams = data.start.customParameters || {};
        const mode = customParams.mode || 'inbound';
        const callerId = customParams.callerId || 'unknown';

        openAIService = new OpenAIRealtimeService(ws, callSid, mode, callerId);
        await openAIService.connect();

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
      markCallEnded(callSid);
    } catch (err) {
      logger.error('Error importing/calling markCallEnded on ws close: ' + err.message);
    }
  });
};
