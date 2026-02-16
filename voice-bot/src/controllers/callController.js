import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';
import { notifyCallEnded } from '../services/dripService.js';
import url from 'url';

const VoiceResponse = twilio.twiml.VoiceResponse;

// Handle Inbound Call (Receptionist)
export const inboundCall = (req, res) => {
  try {
    logger.info('Incoming call received (Receptionist Mode)');
    const response = new VoiceResponse();
    const connect = response.connect();
    const stream = connect.stream({
      url: `wss://${req.headers.host}/voice/stream?type=inbound`,
    });

    res.type('text/xml');
    res.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    res.status(500).send('Internal Server Error');
  }
};

// Handle Outbound Call TwiML (Sarah)
export const outboundTwiml = (req, res) => {
  try {
    const clientId = req.query.clientId;
    logger.info(`Outbound call initiated for client ${clientId}`);

    const response = new VoiceResponse();
    const connect = response.connect();
    const stream = connect.stream({
      url: `wss://${req.headers.host}/voice/stream?type=outbound&clientId=${clientId}`,
    });

    res.type('text/xml');
    res.send(response.toString());
  } catch (error) {
    logger.error('Error generating outbound TwiML:', error);
    res.status(500).send('Internal Server Error');
  }
};

// Handle Call Status Callback (Busy, No-Answer, etc.)
export const handleCallStatus = (req, res) => {
  const status = req.body.CallStatus;
  logger.info(`Call Status Update: ${status}`);

  if (['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(status)) {
      notifyCallEnded();
  }
  res.sendStatus(200);
};

export const handleWebSocket = (ws, req) => {
  logger.info('New WebSocket connection');

  const query = url.parse(req.url, true).query;
  const callType = query.type || 'inbound';
  const clientId = query.clientId || null;

  logger.info(`Call Type: ${callType}, Client ID: ${clientId}`);

  // We can extract CallSid from the query params if we added it in the TwiML url
  // or wait for the 'start' event from Twilio.
  let callSid = 'unknown';

  const openAIService = new OpenAIRealtimeService(ws, callSid, { callType, clientId });
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
    // Notify Drip Service if outbound call ended
    if (callType === 'outbound') {
        notifyCallEnded();
    }
  });
};
