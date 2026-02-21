import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { handleCallEnded } from '../services/dripService.js';
import { config } from '../config/config.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = (req, res) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();

    // Pass callerId from the incoming call (From number)
    const callerId = req.body.From || 'Unknown';

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

export const outboundTwiml = (req, res) => {
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

        stream.parameter({
            name: 'mode',
            value: 'outbound'
        });

        res.type('text/xml');
        res.send(response.toString());

    } catch (error) {
        logger.error('Error handling outbound TwiML:', error);
        res.status(500).send('Internal Server Error');
    }
};

export const handleStatusCallback = (req, res) => {
    const callSid = req.body.CallSid;
    const callStatus = req.body.CallStatus;

    logger.info(`Call status update for ${callSid}: ${callStatus}`);

    if (['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(callStatus)) {
        handleCallEnded();
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
        if (openAIService.openaiWs) {
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
    if (openAIService.openaiWs) {
        openAIService.openaiWs.close();
    }
  });
};
