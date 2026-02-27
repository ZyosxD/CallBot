import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';
import { setCallActive, getOutboundTwiML } from '../services/dripService.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = (req, res) => {
  try {
    logger.info(`Incoming call received from ${req.body.From}`);
    const response = new VoiceResponse();
    const connect = response.connect();
    const stream = connect.stream({
      url: `wss://${req.headers.host}/voice/stream`,
    });

    // Pass parameters for inbound mode
    stream.parameter({
        name: 'callerId',
        value: req.body.From
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

export const outboundCall = (req, res) => {
    try {
        const callerId = req.query.callerId;
        logger.info(`Generating TwiML for outbound call to ${callerId}`);
        const twiml = getOutboundTwiML(callerId);
        res.type('text/xml');
        res.send(twiml);
    } catch (error) {
        logger.error('Error handling outbound call:', error);
        res.status(500).send('Internal Server Error');
    }
};

export const callStatusCallback = (req, res) => {
    const callStatus = req.body.CallStatus;
    const callSid = req.body.CallSid;
    logger.info(`Call status update: ${callSid} is ${callStatus}`);

    if (['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(callStatus)) {
        setCallActive(false);
    }

    res.sendStatus(200);
};

export const handleWebSocket = (ws, req) => {
  logger.info('New WebSocket connection');

  let callSid = 'unknown';
  // These will be updated when the start event arrives
  let callerId = 'unknown';
  let mode = 'inbound';

  const openAIService = new OpenAIRealtimeService(ws, callSid, callerId, mode);
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
