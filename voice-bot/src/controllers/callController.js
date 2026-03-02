import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { callEnded } from '../services/dripService.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = (req, res) => {
  try {
    const callerId = req.body.From;
    logger.info(`Incoming call received from ${callerId}`);

    const response = new VoiceResponse();
    const connect = response.connect();
    const stream = connect.stream({
      url: `wss://${req.headers.host}/voice/stream`,
    });

    stream.parameter({
      name: 'callerId',
      value: callerId
    });
    stream.parameter({
      name: 'mode',
      value: 'inbound'
    });

    res.type('text/xml');
    res.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    res.status(500).send('Internal Server Error');
  }
};

export const statusCallback = (req, res) => {
  try {
    const callStatus = req.body.CallStatus;
    logger.info(`Call status update received: ${callStatus}`);

    if (callStatus === 'completed' || callStatus === 'failed' || callStatus === 'busy' || callStatus === 'no-answer' || callStatus === 'canceled') {
      callEnded();
    }

    res.status(200).send('OK');
  } catch (error) {
    logger.error('Error handling status callback:', error);
    res.status(500).send('Internal Server Error');
  }
};

export const handleWebSocket = (ws, req) => {
  logger.info('New WebSocket connection');

  let openAIService = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        const callSid = data.start.callSid;
        const customParams = data.start.customParameters || {};
        const callerId = customParams.callerId || 'unknown';
        const mode = customParams.mode || 'inbound';

        logger.info(`Stream started: CallSid=${callSid}, mode=${mode}, callerId=${callerId}`);

        openAIService = new OpenAIRealtimeService(ws, callSid, callerId, mode);
        openAIService.connect();
        openAIService.handleTwilioMedia(data);

      } else if (data.event === 'media' && openAIService) {
        openAIService.handleTwilioMedia(data);
      } else if (data.event === 'stop') {
        logger.info('Stream stopped by Twilio');
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
