import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { getClientById } from '../services/leadService.js';
import { onCallEnded } from '../services/dripService.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = async (req, reply) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();
    const stream = connect.stream({
      url: `wss://${req.headers.host}/voice/stream?direction=inbound`,
    });

    reply.type('text/xml');
    reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.code(500).send('Internal Server Error');
  }
};

export const outboundTwiml = async (req, reply) => {
  try {
    const { clientId } = req.query;
    logger.info(`Generating TwiML for outbound call (Client ID: ${clientId})`);

    const response = new VoiceResponse();
    const connect = response.connect();
    // Pass clientId and direction to the stream
    const stream = connect.stream({
      url: `wss://${req.headers.host}/voice/stream?clientId=${clientId}&direction=outbound`,
    });

    reply.type('text/xml');
    reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling outbound TwiML:', error);
    reply.code(500).send('Internal Server Error');
  }
};

export const callStatus = async (req, reply) => {
  const { CallSid, CallStatus } = req.body || {};
  logger.info(`Call Status Update: ${CallSid} -> ${CallStatus}`);

  if (['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(CallStatus)) {
    onCallEnded();
  }

  reply.send('OK');
};

export const handleWebSocket = async (connection, req) => {
  logger.info('New WebSocket connection');
  const ws = connection;

  const { clientId, direction } = req.query || {};
  let clientData = { direction };

  if (clientId) {
      const client = await getClientById(clientId);
      if (client) {
          clientData = { ...clientData, ...client };
      }
  }

  // We can't get CallSid immediately from query params usually unless we put it there in TwiML
  // But for now, we rely on the 'start' message from Twilio to get the CallSid and stream info.
  // OpenAIRealtimeService handles the start message.

  const openAIService = new OpenAIRealtimeService(ws, null, clientData);
  openAIService.connect();

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        const callSid = data.start.callSid;
        openAIService.callSid = callSid;
        openAIService.handleTwilioMedia(data);
        logger.info(`Stream started for CallSid: ${callSid}`);
      } else if (data.event === 'media') {
        openAIService.handleTwilioMedia(data);
      } else if (data.event === 'stop') {
        logger.info(`Stream stopped`);
        if (openAIService.openaiWs) {
             openAIService.openaiWs.close();
        }
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
