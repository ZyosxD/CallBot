import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { markCallEnded } from '../services/dripService.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = async (req, res) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();
    const callerId = (req.body && req.body.From) ? req.body.From : 'unknown';

    // We add custom parameters that will be passed in the start event of the websocket stream
    const stream = connect.stream({
      url: `wss://${req.headers.host}/voice/stream`,
    });

    stream.parameter({
      name: 'mode',
      value: 'inbound'
    });

    stream.parameter({
      name: 'callerId',
      value: callerId
    });

    res.type('text/xml');
    res.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    res.status(500).send('Internal Server Error');
  }
};

export const statusCallback = async (req, res) => {
  try {
    const callStatus = req.body.CallStatus;
    const callSid = req.body.CallSid;

    logger.info(`Status callback received: CallSid ${callSid}, Status ${callStatus}`);

    if (callStatus === 'completed' || callStatus === 'failed' || callStatus === 'busy' || callStatus === 'no-answer' || callStatus === 'canceled') {
      markCallEnded(callSid);
    }

    res.status(200).send('OK');
  } catch (error) {
    logger.error('Error handling status callback:', error);
    res.status(500).send('Internal Server Error');
  }
};

export const handleWebSocket = (ws, req) => {
  logger.info('New WebSocket connection');

  let callSid = 'unknown';
  let openAIService = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;
        const customParams = data.start.customParameters || {};
        const mode = customParams.mode || 'unknown';
        const callerId = customParams.callerId || 'unknown';

        logger.info(`Starting stream for call ${callSid} in mode ${mode} with callerId ${callerId}`);

        openAIService = new OpenAIRealtimeService(ws, callSid, callerId, mode);

        // Let the service know we are started so it can grab the streamSid
        openAIService.handleTwilioMedia(data);

        openAIService.connect();
      } else if (data.event === 'media') {
        if (openAIService) {
          openAIService.handleTwilioMedia(data);
        }
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
    if (openAIService && openAIService.openaiWs) {
        openAIService.openaiWs.close();
    }
    // Also ensure lock is released just in case
    markCallEnded(callSid);
  });
};
