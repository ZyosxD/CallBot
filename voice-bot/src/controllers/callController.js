import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { markCallEnded } from '../services/dripService.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = (req, res) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();

    // Use header host to dynamically construct the websocket url
    const stream = connect.stream({
      url: `wss://${req.headers.host}/voice/stream`,
    });

    // Pass callerId and mode via Twilio stream parameters
    const callerId = req.body.From || 'Unknown';
    stream.parameter({ name: 'callerId', value: callerId });
    stream.parameter({ name: 'mode', value: 'inbound' });

    res.type('text/xml');
    res.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    res.status(500).send('Internal Server Error');
  }
};

export const handleStatusCallback = (req, res) => {
  try {
    const { CallSid, CallStatus } = req.body;
    logger.info(`Call ${CallSid} status changed to ${CallStatus}`);

    if (CallStatus === 'completed' || CallStatus === 'failed' || CallStatus === 'busy' || CallStatus === 'no-answer' || CallStatus === 'canceled') {
       markCallEnded(CallSid);
    }

    res.status(200).send('OK');
  } catch (error) {
    logger.error('Error handling status callback:', error);
    res.status(500).send('Internal Server Error');
  }
}

export const handleWebSocket = (connection, req) => {
  const ws = connection;
  logger.info('New WebSocket connection');

  let callSid = 'unknown';
  let openAIService = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;
        const customParams = data.start.customParameters || {};
        const callerId = customParams.callerId || 'Unknown';
        const mode = customParams.mode || 'inbound';

        openAIService = new OpenAIRealtimeService(ws, callSid, callerId, mode);
        openAIService.connect();

        // Pass the start event along once connected
        // It's safe to call it immediately because it will store streamSid
        openAIService.handleTwilioMedia(data);

      } else if (data.event === 'media') {
        if (openAIService) {
          openAIService.handleTwilioMedia(data);
        }
      } else if (data.event === 'stop') {
        logger.info(`Stream stopped for call ${callSid}`);
        if (openAIService && openAIService.openaiWs) {
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
    if (openAIService && openAIService.openaiWs) {
        openAIService.openaiWs.close();
    }
  });
};
