import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';
import { callEnded } from '../services/dripService.js';
import url from 'url';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = (req, res) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();
    // Add context=inbound
    const stream = connect.stream({
      url: `wss://${req.headers.host}/voice/stream?context=inbound`,
    });

    res.type('text/xml');
    res.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    res.status(500).send('Internal Server Error');
  }
};

export const makeOutboundCall = async (clientData) => {
  const client = twilio(config.twilio.accountSid, config.twilio.authToken);
  const callbackUrl = `${config.server.publicUrl}/voice/outbound-twiml?phone=${encodeURIComponent(clientData.phone)}&name=${encodeURIComponent(clientData.name)}`;
  const statusCallbackUrl = `${config.server.publicUrl}/voice/status-callback`;

  logger.info(`Making outbound call to ${clientData.phone} via ${callbackUrl}`);

  await client.calls.create({
    to: clientData.phone,
    from: config.twilio.phoneNumber,
    url: callbackUrl,
    statusCallback: statusCallbackUrl,
    statusCallbackEvent: ['completed', 'busy', 'no-answer', 'failed']
  });
};

export const outboundTwiml = (req, res) => {
  try {
    const phone = req.query.phone;
    const name = req.query.name;
    const response = new VoiceResponse();
    const connect = response.connect();

    // Construct stream URL with context and client data
    const streamUrl = `wss://${req.headers.host}/voice/stream?context=outbound&phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}`;

    logger.info(`Generating Outbound TwiML with Stream URL: ${streamUrl}`);

    const stream = connect.stream({
      url: streamUrl,
    });

    res.type('text/xml');
    res.send(response.toString());
  } catch (error) {
    logger.error('Error handling outbound TwiML:', error);
    res.status(500).send('Internal Server Error');
  }
};

export const handleStatusCallback = (req, res) => {
  const callStatus = req.body.CallStatus;
  logger.info(`Call Status Update: ${callStatus}`);

  if (['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(callStatus)) {
    callEnded(); // Notify Drip Service
  }

  res.sendStatus(200);
};

export const handleWebSocket = (ws, req) => {
  logger.info('New WebSocket connection');

  const parsedUrl = url.parse(req.url, true);
  const context = parsedUrl.query.context || 'inbound';
  const clientData = {
    phone: parsedUrl.query.phone,
    name: parsedUrl.query.name
  };

  logger.info(`WebSocket Context: ${context}, Client: ${JSON.stringify(clientData)}`);

  let callSid = 'unknown';

  // Pass context and clientData to the service
  const openAIService = new OpenAIRealtimeService(ws, callSid, context, clientData);
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
        callEnded(); // Also release lock on stream stop just in case
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
    callEnded(); // Ensure lock is released
  });
};
