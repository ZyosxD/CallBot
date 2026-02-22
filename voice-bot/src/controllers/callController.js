import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';
import dripService from '../services/dripService.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = (req, res) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();
    const stream = connect.stream({
      url: `wss://${req.headers.host}/voice/stream`,
    });

    // Pass context for inbound calls
    stream.parameter({
        name: 'mode',
        value: 'inbound'
    });
    stream.parameter({
        name: 'callerId',
        value: req.body.From // Pass the caller's number
    });

    res.type('text/xml');
    res.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    res.status(500).send('Internal Server Error');
  }
};

export const outboundTwiml = (req, res) => {
  try {
    const clientId = req.query.clientId;
    const clientName = req.query.clientName;
    logger.info(`Generating TwiML for outbound call to client ${clientId}`);

    const response = new VoiceResponse();
    const connect = response.connect();
    const stream = connect.stream({
      url: `wss://${req.headers.host}/voice/stream`,
    });

    // Pass context for outbound calls
    stream.parameter({
        name: 'mode',
        value: 'outbound'
    });
    stream.parameter({
        name: 'clientId',
        value: clientId
    });
    stream.parameter({
        name: 'callerId',
        value: clientName // Using client name as caller ID context for now, or could use phone
    });

    res.type('text/xml');
    res.send(response.toString());
  } catch (error) {
    logger.error('Error generating outbound TwiML:', error);
    res.status(500).send('Internal Server Error');
  }
};

export const callStatus = (req, res) => {
  const callSid = req.body.CallSid;
  const status = req.body.CallStatus;

  logger.info(`Call status update: ${callSid} is ${status}`);

  if (['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(status)) {
      dripService.notifyCallEnded(callSid);
  }

  res.sendStatus(200);
};

export const handleWebSocket = (ws, req) => {
  logger.info('New WebSocket connection');

  let callSid = 'unknown';

  const openAIService = new OpenAIRealtimeService(ws, callSid);
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
    // Also notify drip service just in case status callback fails or is delayed
    dripService.notifyCallEnded(callSid);
  });
};
