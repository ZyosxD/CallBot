import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { markCallEnded } from '../services/dripService.js';
import { config } from '../config/config.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = async (request, reply) => {
  try {
    logger.info('Incoming call received');

    // Safely extract caller ID from Twilio's request body
    const callerId = (request.body && request.body.From) ? request.body.From : 'unknown';

    const response = new VoiceResponse();
    const connect = response.connect();

    // Create the stream URL. When using fastify-websocket on a prefix route,
    // the absolute URL is required for Twilio TwiML.
    const streamUrl = `wss://${request.headers.host}/voice/stream`;

    const stream = connect.stream({
      url: streamUrl,
    });

    // Pass custom parameters to Twilio Stream so the websocket handler can pick them up
    stream.parameter({ name: 'callerId', value: callerId });
    stream.parameter({ name: 'mode', value: 'inbound' });

    reply.type('text/xml');
    return reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    return reply.code(500).send('Internal Server Error');
  }
};

export const handleTwilioStatus = async (request, reply) => {
  try {
    const callSid = request.body.CallSid;
    const callStatus = request.body.CallStatus;

    logger.info(`Twilio status callback: Call ${callSid} is ${callStatus}`);

    // If the call is completed, failed, busy, or no-answer, release the outbound drip lock
    if (['completed', 'failed', 'busy', 'no-answer', 'canceled'].includes(callStatus)) {
      markCallEnded(callSid);
    }

    return reply.send('OK');
  } catch (error) {
    logger.error('Error handling Twilio status callback:', error);
    return reply.code(500).send('Internal Server Error');
  }
};

export const handleWebSocket = (connection, request) => {
  logger.info('New WebSocket connection');

  // Fastify v11 passes the connection object. The actual websocket is at connection.socket
  const ws = connection.socket ? connection.socket : connection;

  let callSid = 'unknown';
  let callerId = 'unknown';
  let mode = 'inbound';

  let openAIService = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());

      if (data.event === 'start') {
        callSid = data.start.callSid;

        // Extract custom parameters sent from TwiML
        if (data.start.customParameters) {
          callerId = data.start.customParameters.callerId || 'unknown';
          mode = data.start.customParameters.mode || 'inbound';
        }

        // Initialize the OpenAI service once we have the parameters from Twilio
        openAIService = new OpenAIRealtimeService(ws, callSid, callerId, mode);
        openAIService.connect();

        openAIService.handleTwilioMedia(data);
      } else if (data.event === 'media') {
        if (openAIService) {
          openAIService.handleTwilioMedia(data);
        }
      } else if (data.event === 'stop') {
        logger.info(`Stream stopped for call ${callSid}`);
        // If it was an outbound call that stopped streaming, ensure we mark it ended
        // The status callback usually handles this, but it's good to have a fallback
        markCallEnded(callSid);
        ws.close();
      }
    } catch (error) {
      logger.error('Error processing WebSocket message:', error);
    }
  });

  ws.on('close', () => {
    logger.info('WebSocket connection closed');
    if (openAIService && openAIService.openaiWs) {
        openAIService.openaiWs.close();
    }
    // Fallback release lock
    if (callSid !== 'unknown') {
      markCallEnded(callSid);
    }
  });
};
