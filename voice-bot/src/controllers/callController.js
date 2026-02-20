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

    // Pass context=inbound
    const stream = connect.stream({
      url: `wss://${req.headers.host}/voice/stream?context=inbound`,
    });

    // Pass caller ID as a parameter to the stream
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

export const outboundTwiml = (req, res) => {
    try {
        const clientId = req.query.clientId || 'unknown';
        logger.info(`Generating TwiML for outbound call to client ${clientId}`);
        const response = new VoiceResponse();
        const connect = response.connect();

        // Pass context=outbound
        const stream = connect.stream({
          url: `wss://${req.headers.host}/voice/stream?context=outbound&clientId=${clientId}`,
        });

        // Pass caller ID (the person we called) as a parameter
        stream.parameter({
            name: 'callerId',
            value: req.body.To
        });

        res.type('text/xml');
        res.send(response.toString());
      } catch (error) {
        logger.error('Error handling outbound TwiML:', error);
        res.status(500).send('Internal Server Error');
      }
};

export const statusCallback = (req, res) => {
    try {
        const callSid = req.body.CallSid;
        const callStatus = req.body.CallStatus;
        logger.info(`Call status update: ${callSid} -> ${callStatus}`);

        if (['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(callStatus)) {
            callEnded(); // Notify drip service
        }

        res.status(200).send('OK');
    } catch (error) {
        logger.error('Error handling status callback:', error);
        res.status(500).send('Internal Server Error');
    }
};

export const handleWebSocket = (ws, req) => {
  // Extract query params from req.url
  const url = new URL(req.url, `http://${req.headers.host}`);
  const context = url.searchParams.get('context') || 'inbound';
  const clientId = url.searchParams.get('clientId');

  logger.info(`New WebSocket connection. Context: ${context}, ClientID: ${clientId}`);

  let callSid = 'unknown';

  const openAIService = new OpenAIRealtimeService(ws, callSid, context);
  openAIService.connect();

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;
        openAIService.callSid = callSid;
        openAIService.handleTwilioMedia(data);
        logger.info(`Call started: ${callSid}`);
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
