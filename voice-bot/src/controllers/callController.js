import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import { setCallActive } from '../services/dripService.js';
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

    // Inbound mode
    stream.parameter({
        name: 'mode',
        value: 'inbound'
    });

    // We can also pass callerId from the request
    const callerId = req.body.From || 'Unknown';
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

export const outboundCall = (req, res) => {
  try {
    const clientId = req.query.clientId;
    logger.info(`Generating TwiML for outbound call to client ${clientId}`);

    const response = new VoiceResponse();
    const connect = response.connect();
    const stream = connect.stream({
      url: `wss://${req.headers.host}/voice/stream`,
    });

    // Outbound mode
    stream.parameter({
        name: 'mode',
        value: 'outbound'
    });

    if (clientId) {
        stream.parameter({
            name: 'clientId',
            value: clientId
        });
    }

    // For outbound, the 'callerId' logic is tricky because we are calling them.
    // req.body.To is the destination (the client).
    const clientPhone = req.body.To || 'Unknown';
    stream.parameter({
        name: 'callerId',
        value: clientPhone
    });

    res.type('text/xml');
    res.send(response.toString());
  } catch (error) {
    logger.error('Error handling outbound TwiML generation:', error);
    res.status(500).send('Internal Server Error');
  }
};

export const handleStatusCallback = (req, res) => {
    const status = req.body.CallStatus;
    logger.info(`Call status update: ${status}`);

    if (['completed', 'failed', 'busy', 'no-answer', 'canceled'].includes(status)) {
        logger.info('Call ended, releasing concurrency lock.');
        setCallActive(false);
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
        const customParams = data.start.customParameters || {};
        const mode = customParams.mode || 'inbound';
        const clientId = customParams.clientId || null;
        const callerId = customParams.callerId || 'Unknown';

        logger.info(`Stream started for call ${callSid} in mode: ${mode}`);

        openAIService = new OpenAIRealtimeService(ws, callSid, callerId, mode, clientId);
        openAIService.connect();
        openAIService.handleTwilioMedia(data);
      } else if (openAIService) {
        // Delegate media and other events to the service
        if (data.event === 'media') {
            openAIService.handleTwilioMedia(data);
        } else if (data.event === 'stop') {
            logger.info(`Stream stopped for call ${callSid}`);
            ws.close();
            // Also ensure we release lock if needed, though status callback is safer
            // But for inbound calls, status callback might not be set up in the same way?
            // Usually status callback is set on call creation.
            // For inbound, we can't easily set statusCallback unless we configure the number URL.
            // But we can assume inbound doesn't block the drip service anyway (Drip checks its own lock).
            // Wait, if an inbound call is active, should Drip run? The user didn't specify.
            // But Drip uses 'isCallActive' which is set by 'initiateCall'.
            // So inbound calls don't block outbound calls unless we want them to.
            // I'll stick to Drip only blocking itself for now.
        }
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
