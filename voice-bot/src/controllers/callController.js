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

    // Inject mode parameter based on source if needed
    const mode = request.body?.Direction === 'outbound-api' ? 'outbound' : 'inbound';

    const stream = connect.stream({
      url: `wss://${request.headers.host}/voice/stream`,
    });

    stream.parameter({ name: 'mode', value: mode });

    reply.type('text/xml').send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const inboundStatus = async (request, reply) => {
  try {
    const { CallStatus, CallSid } = request.body;
    logger.info(`Call status update: ${CallSid} is ${CallStatus}`);

    // Terminal states
    if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(CallStatus)) {
      const { markCallEnded } = await import('../services/dripService.js');
      markCallEnded(CallSid);
    }
    reply.send('OK');
  } catch (error) {
    logger.error('Error handling inbound status:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const handleWebSocket = (ws, request) => {
  logger.info('New WebSocket connection');

  // Extract callerId using optional chaining safely
  const callerId = request.query?.callerId || request.body?.From || 'unknown';

  let callSid = 'unknown';

  const openAIService = new OpenAIRealtimeService(ws, callSid, callerId);
  openAIService.connect();

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;
        openAIService.callSid = callSid;

        // Use custom parameters for mode if they exist
        const mode = data.start.customParameters?.mode || 'inbound';
        openAIService.mode = mode;

        openAIService.handleTwilioMedia(data);
      } else if (data.event === 'media') {
        openAIService.handleTwilioMedia(data);
      } else if (data.event === 'stop') {
        logger.info(`Stream stopped for call ${callSid}`);

        // Forcefully release the dialing lock when calls disconnect
        const { markCallEnded } = await import('../services/dripService.js');
        markCallEnded(callSid);

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

    // Also release here just in case 'stop' wasn't received
    const { markCallEnded } = await import('../services/dripService.js');
    markCallEnded(callSid);
  });
};
