import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { handleCallEnded } from '../services/dripService.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = async (req, reply) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();

    // Pass callerId and mode as parameters
    const stream = connect.stream({
      url: `wss://${req.headers.host}/voice/stream`,
    });

    stream.parameter({ name: 'callerId', value: req.body.From });
    stream.parameter({ name: 'mode', value: 'inbound' });

    reply.type('text/xml');
    reply.send(response.toString());
  } catch (error) {
    logger.error(`Error handling inbound call: ${error.message}`);
    reply.status(500).send('Internal Server Error');
  }
};

export const statusCallback = async (req, reply) => {
  try {
    const { CallStatus, CallSid } = req.body;
    logger.info(`Call ${CallSid} status updated to ${CallStatus}`);

    if (['completed', 'failed', 'busy', 'no-answer', 'canceled'].includes(CallStatus)) {
      handleCallEnded();
    }

    reply.status(200).send('OK');
  } catch (error) {
    logger.error(`Error in status callback: ${error.message}`);
    reply.status(500).send('Error processing status update');
  }
};

export const handleWebSocket = (connection, req) => {
  const ws = connection.socket || connection; // For @fastify/websocket compatibility
  logger.info('New WebSocket connection');

  let callSid = 'unknown';
  let callerId = 'unknown';
  let mode = 'inbound';
  let openAIService = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;

        // Extract callerId and mode from custom parameters
        const customParams = data.start.customParameters || {};
        callerId = customParams.callerId || 'unknown';
        mode = customParams.mode || 'inbound';

        logger.info(`Stream started - CallSid: ${callSid}, CallerId: ${callerId}, Mode: ${mode}`);

        openAIService = new OpenAIRealtimeService(ws, callSid, callerId, mode);
        openAIService.connect();

        // We delay passing the start event until OpenAI is connected, or pass it directly if we handle the flow inside
        openAIService.handleTwilioMedia(data);

      } else if (data.event === 'media' && openAIService) {
        openAIService.handleTwilioMedia(data);
      } else if (data.event === 'stop') {
        logger.info(`Stream stopped for call ${callSid}`);
        if (openAIService && openAIService.openaiWs) {
          openAIService.openaiWs.close();
        }
        ws.close();
      }
    } catch (error) {
      logger.error(`Error processing WebSocket message: ${error.message}`);
    }
  });

  ws.on('close', () => {
    logger.info('WebSocket connection closed');
    if (openAIService && openAIService.openaiWs) {
        openAIService.openaiWs.close();
    }
  });
};
