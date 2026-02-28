import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { handleCallEnded } from '../services/dripService.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = (req, res) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();

    // Pass callerId and mode as custom stream parameters
    const stream = connect.stream({
      url: `wss://${req.headers.host}/voice/stream`,
    });

    stream.parameter({ name: 'mode', value: 'inbound' });
    stream.parameter({ name: 'callerId', value: req.body.From || 'Unknown' });

    res.type('text/xml');
    res.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    res.status(500).send('Internal Server Error');
  }
};

export const statusCallback = (req, res) => {
  const callStatus = req.body.CallStatus;
  const callSid = req.body.CallSid;
  logger.info(`Status callback received. CallSid: ${callSid}, Status: ${callStatus}`);

  if (['completed', 'failed', 'busy', 'no-answer', 'canceled'].includes(callStatus)) {
      handleCallEnded();
  }

  res.sendStatus(200);
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

        logger.info(`Stream started. CallSid: ${callSid}, CallerId: ${callerId}, Mode: ${mode}`);

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
