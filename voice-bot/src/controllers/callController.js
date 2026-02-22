import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import { callEnded } from '../services/dripService.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = (req, res) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();

    // Pass 'inbound' mode and callerId to the stream URL
    const streamUrl = `wss://${req.headers.host}/voice/stream`;
    const stream = connect.stream({
      url: streamUrl
    });

    // Custom parameters are passed via <Parameter> in TwiML
    stream.parameter({
      name: 'mode',
      value: 'inbound'
    });
    stream.parameter({
      name: 'callerId',
      value: req.body.From
    });

    res.type('text/xml');
    res.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    res.status(500).send('Internal Server Error');
  }
};

export const handleCallStatus = (req, res) => {
    const status = req.body.CallStatus;
    logger.info(`Call status update: ${status}`);
    if (['completed', 'busy', 'no-answer', 'failed'].includes(status)) {
        callEnded();
    }
    res.sendStatus(200);
}

export const handleWebSocket = (ws, req) => {
  logger.info('New WebSocket connection');

  let callSid = 'unknown';
  let openAIService = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;
        const customParams = data.start.customParameters;
        const mode = (customParams && customParams.mode) ? customParams.mode : 'inbound';
        const callerId = (customParams && customParams.callerId) ? customParams.callerId : 'Unknown';

        logger.info(`Stream started for call ${callSid} in mode ${mode}`);

        openAIService = new OpenAIRealtimeService(ws, callSid, mode, callerId);
        openAIService.connect();
        openAIService.handleTwilioMedia(data);

      } else if (data.event === 'media') {
        if (openAIService) {
          openAIService.handleTwilioMedia(data);
        }
      } else if (data.event === 'stop') {
        logger.info(`Stream stopped for call ${callSid}`);
        if (openAIService) {
             if (openAIService.openaiWs) {
                openAIService.openaiWs.close();
            }
        }
        ws.close();
        callEnded(); // Ensure drip lock is released
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
    callEnded(); // Ensure drip lock is released
  });
};
