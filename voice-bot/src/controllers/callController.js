import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';
import { markCallEnded } from '../services/dripService.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = (req, reply) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();

    // Inject "mode" and "callerId" to recognize this as inbound
    connect.stream({
      url: `wss://${req.headers.host}/voice/stream`,
    })
      .parameter({ name: 'mode', value: 'inbound' })
      .parameter({ name: 'callerId', value: req.body.From });

    reply.type('text/xml').send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.status(500).send('Internal Server Error');
  }
};

export const handleStatusCallback = (req, reply) => {
  const callStatus = req.body.CallStatus;
  const callSid = req.body.CallSid;

  logger.info(`Status Callback received: CallSid=${callSid}, Status=${callStatus}`);

  if (['completed', 'failed', 'busy', 'no-answer', 'canceled'].includes(callStatus)) {
    markCallEnded(callSid);
  }

  reply.send('OK');
};

export const handleWebSocket = (connection, req) => {
  logger.info('New WebSocket connection');
  const ws = connection;
  let callSid = 'unknown';

  const openAIService = new OpenAIRealtimeService(ws, callSid);
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

  ws.on('close', () => {
    logger.info('WebSocket connection closed');
    if (openAIService.openaiWs) {
        openAIService.openaiWs.close();
    }
  });
};
