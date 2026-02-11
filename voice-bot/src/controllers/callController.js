import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';
import { makeNextCall } from '../services/dripService.js';
import url from 'url';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = (req, res) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();

    // Inbound call - no specific clientId known initially unless we lookup by phone (not implemented yet)
    const stream = connect.stream({
      url: `wss://${req.headers.host}/voice/stream?direction=inbound`,
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
    const { clientId, phone } = req.query;
    logger.info(`Outbound call TwiML request for client ${clientId}`);

    const response = new VoiceResponse();
    const connect = response.connect();

    // Pass context to WebSocket
    const streamUrl = `wss://${req.headers.host}/voice/stream?direction=outbound&clientId=${clientId}&phone=${encodeURIComponent(phone)}`;
    const stream = connect.stream({
      url: streamUrl
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

    logger.info(`Call Status Update: ${callSid} -> ${callStatus}`);

    if (['completed', 'busy', 'no-answer', 'failed'].includes(callStatus)) {
        // Trigger next call in drip
        makeNextCall();
    }

    res.sendStatus(200);
};

export const handleWebSocket = (ws, req) => {
  logger.info(`New WebSocket connection: ${req.url}`);

  // Extract query params
  const parsedUrl = url.parse(req.url, true);
  const query = parsedUrl.query;

  const direction = query.direction || 'inbound';
  const clientId = query.clientId || null;
  const clientPhone = query.phone || null; // For outbound verification

  let callSid = 'unknown';

  const openAIService = new OpenAIRealtimeService(ws, callSid, {
      direction,
      clientId,
      clientPhone
  });
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
