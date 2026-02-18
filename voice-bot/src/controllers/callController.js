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
    // Pass context=inbound and callerId
    const stream = connect.stream({
      url: `wss://${req.headers.host}/voice/stream?context=inbound&callerId=${encodeURIComponent(req.body.From)}`,
    });

    res.type('text/xml');
    res.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    res.status(500).send('Internal Server Error');
  }
};

export const outboundTwiML = (req, res) => {
    try {
        const clientId = req.query.clientId;
        logger.info(`Generating TwiML for outbound call to client ${clientId}`);
        const response = new VoiceResponse();
        const connect = response.connect();
        // Pass context=outbound and clientId
        const stream = connect.stream({
            url: `wss://${req.headers.host}/voice/stream?context=outbound&clientId=${clientId}`,
        });

        res.type('text/xml');
        res.send(response.toString());
    } catch (error) {
        logger.error('Error handling outbound TwiML:', error);
        res.status(500).send('Internal Server Error');
    }
};

export const statusCallback = (req, res) => {
    const callStatus = req.body.CallStatus;
    logger.info(`Call Status Update: ${callStatus}`);

    if (['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(callStatus)) {
        callEnded();
    }

    res.sendStatus(200);
};

export const handleWebSocket = (ws, req) => {
  logger.info('New WebSocket connection');

  // Extract query params
  const url = new URL(req.url, `http://${req.headers.host}`);
  const context = url.searchParams.get('context') || 'inbound';
  const clientId = url.searchParams.get('clientId');
  const callerId = url.searchParams.get('callerId');

  let callSid = 'unknown';

  // Pass context and clientId/callerId to service
  const openAIService = new OpenAIRealtimeService(ws, callSid, { context, clientId, callerId });
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
