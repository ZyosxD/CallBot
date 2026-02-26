import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import { onCallEnded } from '../services/dripService.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = (req, res) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();
    const stream = connect.stream({
      url: `wss://${req.headers.host}/voice/stream`,
    });

    // For inbound, we might not know the name, so we use the From number
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

export const outboundCall = (req, res) => {
    try {
        const callerId = req.query.callerId || 'Unknown';
        logger.info(`Generating TwiML for outbound call to ${callerId}`);

        const response = new VoiceResponse();
        const connect = response.connect();
        const stream = connect.stream({
            url: `wss://${req.headers.host}/voice/stream`
        });

        stream.parameter({
            name: 'callerId',
            value: callerId
        });

        res.type('text/xml');
        res.send(response.toString());

    } catch (error) {
        logger.error('Error handling outbound call TwiML:', error);
        res.status(500).send('Internal Server Error');
    }
};

export const callStatus = (req, res) => {
    const callSid = req.body.CallSid;
    const callStatus = req.body.CallStatus;

    logger.info(`Call Status Update [${callSid}]: ${callStatus}`);

    if (['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(callStatus)) {
        onCallEnded();
    }

    res.sendStatus(200);
};

export const handleWebSocket = (ws, req) => {
  logger.info('New WebSocket connection');

  let callSid = 'unknown';
  // We initialize with null callerId, it will be updated when 'start' event arrives
  const openAIService = new OpenAIRealtimeService(ws, callSid, null);
  openAIService.connect();

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;
        openAIService.callSid = callSid;
        openAIService.handleTwilioMedia(data);
      } else if (data.event === 'media') {
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
    if (openAIService.openaiWs) {
        openAIService.openaiWs.close();
    }
  });
};
