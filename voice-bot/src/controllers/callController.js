import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';
import { onCallEnded } from '../services/dripService.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const incomingCall = async (req, reply) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();
    // Default to inbound direction if not specified (though this is the inbound webhook)
    const stream = connect.stream({
      url: `wss://${req.headers.host}/voice/stream?direction=inbound`,
    });

    reply.type('text/xml').send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.code(500).send('Internal Server Error');
  }
};

export const outboundTwiml = async (req, reply) => {
  try {
    const { clientId, phone } = req.query;
    logger.info(`Generating Outbound TwiML for Client ${clientId} (${phone})`);

    const response = new VoiceResponse();
    const connect = response.connect();
    const stream = connect.stream({
      url: `wss://${req.headers.host}/voice/stream?clientId=${clientId}&direction=outbound&phone=${encodeURIComponent(phone)}`,
    });

    reply.type('text/xml').send(response.toString());
  } catch (error) {
    logger.error('Error handling outbound TwiML:', error);
    reply.code(500).send('Internal Server Error');
  }
};

export const handleWebSocket = (connection, req) => {
  logger.info('New WebSocket connection');

  // Extract query params from the request URL
  // req.url is the relative URL, e.g. /voice/stream?clientId=1&...
  const url = new URL(req.url, `http://${req.headers.host}`);
  const clientId = url.searchParams.get('clientId') || 'unknown';
  const direction = url.searchParams.get('direction') || 'inbound';
  const phone = url.searchParams.get('phone') || 'unknown';
  const callerId = phone; // Using phone as callerId for now

  let callSid = 'unknown';

  const openAIService = new OpenAIRealtimeService(connection.socket, callSid, clientId, { callerId, direction });
  openAIService.connect();

  connection.socket.on('message', (message) => {
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
        // connection.socket.close(); // Handled by OpenAI service
      }
    } catch (error) {
      logger.error('Error processing WebSocket message:', error);
    }
  });

  connection.socket.on('close', () => {
    logger.info('WebSocket connection closed');
    if (openAIService.openaiWs) {
        openAIService.openaiWs.close();
    }
  });
};

export const callStatus = async (req, reply) => {
  const { CallSid, CallStatus } = req.body;
  logger.info(`Call Status Update: ${CallSid} is ${CallStatus}`);

  if (['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(CallStatus)) {
    // Notify Drip Service
    onCallEnded();
  }

  reply.code(200).send('OK');
};
