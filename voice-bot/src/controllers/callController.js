import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';
import { callEnded } from '../services/dripService.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = (req, res) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();

    // Determine callerId
    // If direction=outbound, From is bot, To is user.
    // If inbound, From is user.
    // We want to pass the User's number as callerId to the stream.

    let callerId = req.body.From;
    if (req.query.direction === 'outbound') {
        callerId = req.body.To;
    }

    logger.info(`Caller ID for stream: ${callerId}`);

    const stream = connect.stream({
      url: `wss://${req.headers.host}/voice/stream`,
    });

    stream.parameter({
        name: 'callerId',
        value: callerId
    });

    const mode = req.query.direction === 'outbound' ? 'OUTBOUND' : 'INBOUND';
    stream.parameter({
        name: 'mode',
        value: mode
    });

    res.type('text/xml');
    res.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    res.status(500).send('Internal Server Error');
  }
};

export const callStatusCallback = (req, res) => {
    const callStatus = req.body.CallStatus;
    logger.info(`Call status update: ${callStatus}`);

    if (['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(callStatus)) {
        callEnded();
    }

    res.sendStatus(200);
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
        const customParams = data.start.customParameters;
        const callerId = customParams.callerId || 'unknown';
        const mode = customParams.mode || 'INBOUND';

        logger.info(`Stream started for CallSid: ${callSid}, CallerId: ${callerId}, Mode: ${mode}`);

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
