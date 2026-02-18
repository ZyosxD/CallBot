import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';
import { callEnded } from '../services/dripService.js';
import { URL } from 'url';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = (req, res) => {
  try {
    logger.info('Incoming call received (Inbound)');
    const response = new VoiceResponse();
    const connect = response.connect();
    // Default to 'inbound' context
    const streamUrl = `wss://${req.headers.host}/voice/stream?context=inbound`;

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

export const outboundTwiml = (req, res) => {
  try {
    const clientId = req.query.clientId;
    logger.info(`Generating TwiML for outbound call (Client ID: ${clientId})`);

    const response = new VoiceResponse();
    const connect = response.connect();
    // Set 'outbound' context and pass clientId
    const streamUrl = `wss://${req.headers.host}/voice/stream?context=outbound&clientId=${clientId}`;

    connect.stream({
      url: streamUrl,
    });

    res.type('text/xml');
    res.send(response.toString());
  } catch (error) {
    logger.error('Error generating outbound TwiML:', error);
    res.status(500).send('Internal Server Error');
  }
};

export const handleStatusCallback = (req, res) => {
  const callStatus = req.body.CallStatus;
  const callSid = req.body.CallSid;

  logger.info(`Call status update: ${callSid} -> ${callStatus}`);

  if (['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(callStatus)) {
    callEnded();
  }

  res.sendStatus(200);
};

export const handleWebSocket = (ws, req) => {
  try {
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
          logger.info(`Stream started for CallSid: ${callSid}`);
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
      // Outbound calls release lock via status callback, but if WS closes early,
      // the status callback will eventually fire.
    });
  } catch (error) {
    logger.error('Error handling WebSocket connection:', error);
    ws.close();
  }
};
