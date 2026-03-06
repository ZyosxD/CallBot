import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';
import { onCallEnded } from '../services/dripService.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = (req, reply) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();
    const host = req.headers.host;

    // Fallback if host header isn't available
    const streamUrl = host ? `wss://${host}/voice/stream` : `wss://${new URL(config.server.publicUrl).host}/voice/stream`;

    const stream = connect.stream({
      url: streamUrl,
    });

    stream.parameter({ name: 'mode', value: 'inbound' });
    stream.parameter({ name: 'callerId', value: req.body.From || 'Unknown' });

    reply.type('text/xml');
    reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const callStatusCallback = (req, reply) => {
  const status = req.body.CallStatus;
  const callSid = req.body.CallSid;

  logger.info(`Call ${callSid} status changed to ${status}`);

  if (['completed', 'busy', 'no-answer', 'canceled', 'failed'].includes(status)) {
    onCallEnded();
  }

  reply.status(200).send('OK');
};

export const handleWebSocket = (ws, req) => {
  logger.info('New WebSocket connection established');

  let callSid = 'unknown';
  let callerId = 'unknown';
  let mode = 'inbound';

  let openAIService = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;

        // Extract custom parameters
        const customParams = data.start.customParameters || {};
        callerId = customParams.callerId || 'unknown';
        mode = customParams.mode || 'inbound';

        logger.info(`Stream started. CallSid: ${callSid}, CallerId: ${callerId}, Mode: ${mode}`);

        openAIService = new OpenAIRealtimeService(ws, callSid, callerId, mode);
        openAIService.connect();
        openAIService.handleTwilioMedia(data);

      } else if (data.event === 'media' && openAIService) {
        openAIService.handleTwilioMedia(data);
      } else if (data.event === 'stop') {
        logger.info(`Stream stopped for call ${callSid}`);
        if (openAIService) {
            if (openAIService.openaiWs) {
                openAIService.openaiWs.close();
            }
        }
        ws.close();
      }
    } catch (error) {
      logger.error('Error processing WebSocket message:', error);
    }
  });

  ws.on('close', () => {
    logger.info('Twilio WebSocket connection closed');
    if (openAIService && openAIService.openaiWs) {
        openAIService.openaiWs.close();
    }
  });
};
