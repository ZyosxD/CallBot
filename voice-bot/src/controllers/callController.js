import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = (req, res) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();
    const stream = connect.stream({
      url: `wss://${req.headers.host}/voice/stream`,
    });

    const callerId = req.body.From || 'unknown';

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

export const handleWebSocket = (ws, req) => {
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
        if (data.start.customParameters) {
          callerId = data.start.customParameters.callerId || 'unknown';
          mode = data.start.customParameters.mode || 'inbound';
        }

        openAIService = new OpenAIRealtimeService(ws, callSid, callerId, mode);
        openAIService.connect();
        openAIService.handleTwilioMedia(data);
      } else if (data.event === 'media' && openAIService) {
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
    if (openAIService && openAIService.openaiWs) {
        openAIService.openaiWs.close();
    }
  });
};

export const statusCallback = (req, res) => {
  try {
    const callStatus = req.body.CallStatus;
    const callSid = req.body.CallSid;
    logger.info(`Call ${callSid} status updated to: ${callStatus}`);

    import('../services/dripService.js').then(module => {
      if (['completed', 'failed', 'busy', 'no-answer', 'canceled'].includes(callStatus)) {
         module.handleCallEnded();
      }
    }).catch(err => {
      logger.error('Error importing dripService dynamically for status callback', err);
    });

    res.status(200).send('OK');
  } catch (error) {
    logger.error('Error in status callback:', error);
    res.status(500).send('Internal Server Error');
  }
};
