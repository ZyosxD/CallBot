import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { setCallActive } from '../services/dripService.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = (req, res) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();
    const stream = connect.stream({
      url: `wss://${req.headers.host}/voice/stream`,
    });

    // Pass parameters to the stream
    stream.parameter({
      name: 'callerId',
      value: req.body.From || 'Unknown'
    });
    stream.parameter({
      name: 'mode',
      value: 'INBOUND'
    });

    res.type('text/xml');
    res.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    res.status(500).send('Internal Server Error');
  }
};

export const handleWebSocket = (ws, req) => {
  logger.info('New WebSocket connection');

  // We will initialize service once we get the 'start' message with custom parameters
  let openAIService = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        const callSid = data.start.callSid;
        const customParams = data.start.customParameters || {};
        const callerId = customParams.callerId || 'Unknown';
        const mode = customParams.mode || 'INBOUND'; // Default to INBOUND if not set

        logger.info(`Call started: ${callSid}, Mode: ${mode}, Caller: ${callerId}`);

        openAIService = new OpenAIRealtimeService(ws, callSid, callerId, mode);
        openAIService.connect();
        openAIService.handleTwilioMedia(data);

      } else if (data.event === 'media' && openAIService) {
        openAIService.handleTwilioMedia(data);
      } else if (data.event === 'stop') {
        logger.info('Stream stopped');
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
    // Ensure we release the lock if it was an outbound call that ended abruptly
    // However, rely on statusCallback for accurate call end
  });
};

export const handleStatusCallback = (req, res) => {
  const callSid = req.body.CallSid;
  const callStatus = req.body.CallStatus;

  logger.info(`Call status update for ${callSid}: ${callStatus}`);

  if (['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(callStatus)) {
    setCallActive(false);
  }

  res.sendStatus(200);
};
