import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';
import { markCallEnded } from '../services/dripService.js';
import { URL } from 'url';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = (req, res) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();

    // Twilio passes the caller's number in req.body.From
    const callerPhone = req.body.From || '';

    // Pass context=inbound and the caller's phone number
    const streamUrl = `wss://${req.headers.host}/voice/stream?context=inbound&phone=${encodeURIComponent(callerPhone)}`;

    connect.stream({
      url: streamUrl,
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
    const { phone, name, company } = req.query;
    logger.info(`Generating TwiML for outbound call to ${phone}`);

    const response = new VoiceResponse();
    const connect = response.connect();

    // Construct WebSocket URL with parameters
    const params = new URLSearchParams({
      context: 'outbound',
      phone: phone || '',
      name: name || '',
      company: company || ''
    });

    const streamUrl = `wss://${req.headers.host}/voice/stream?${params.toString()}`;

    connect.stream({
      url: streamUrl,
    });

    res.type('text/xml');
    res.send(response.toString());

  } catch (error) {
    logger.error('Error handling outbound call TwiML:', error);
    res.status(500).send('Internal Server Error');
  }
};

export const handleStatusCallback = (req, res) => {
  const { CallStatus } = req.body;
  logger.info(`Call Status Update: ${CallStatus}`);

  if (['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(CallStatus)) {
    markCallEnded();
  }

  res.sendStatus(200);
};

export const handleWebSocket = (ws, req) => {
  logger.info(`New WebSocket connection: ${req.url}`);

  // Parse query params
  // req.url is like "/voice/stream?context=outbound&phone=..."
  // We need to parse it relative to a dummy base
  const url = new URL(req.url, `http://${req.headers.host}`);
  const context = url.searchParams.get('context') || 'inbound';
  const clientData = {
    phone: url.searchParams.get('phone'),
    name: url.searchParams.get('name'),
    company: url.searchParams.get('company')
  };

  let callSid = 'unknown';

  const openAIService = new OpenAIRealtimeService(ws, callSid, clientData, context);
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
    openAIService.endInteraction(); // Notify service (and Drip)
    if (openAIService.openaiWs) {
        openAIService.openaiWs.close();
    }
  });
};
