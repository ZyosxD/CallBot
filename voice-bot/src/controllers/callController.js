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

    // Extract callerId for inbound calls (receptionist mode)
    const callerId = request.body?.From || 'unknown';
    const streamUrl = `wss://${request.headers.host}/voice/stream?mode=inbound&callerId=${encodeURIComponent(callerId)}`;

    connect.stream({ url: streamUrl });

    reply.type('text/xml').send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const inboundStatus = async (request, reply) => {
  try {
    const { CallSid, CallStatus } = request.body;
    logger.info(`Call status update - SID: ${CallSid}, Status: ${CallStatus}`);

    // Terminal states that should release the outbound dialing lock
    if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(CallStatus)) {
      markCallEnded(CallSid);
    }

    reply.status(200).send('OK');
  } catch (error) {
    logger.error('Error handling call status:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const handleWebSocket = (ws, req) => {
  logger.info('New WebSocket connection');

  let callSid = 'unknown';
  const mode = req.query?.mode || 'inbound';
  const callerId = req.query?.callerId || 'unknown';

  const openAIService = new OpenAIRealtimeService(ws, callSid, mode, callerId);
  openAIService.connect();

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;
        openAIService.callSid = callSid; // Update SID once Twilio provides it
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
    logger.info(`WebSocket connection closed for call ${callSid}`);

    // Dynamically import to ensure we can forcefully release the lock on close
    try {
      const { markCallEnded } = await import('../services/dripService.js');
      markCallEnded(callSid);
    } catch (err) {
      logger.error('Error importing markCallEnded dynamically on close:', err);
    }

    if (openAIService.openaiWs && openAIService.openaiWs.readyState === 1) { // 1 = OPEN
      openAIService.openaiWs.close();
    }
  });
};
