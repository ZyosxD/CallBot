import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';
import { onCallEnded } from '../services/dripService.js';
import { URL } from 'url';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = (req, res) => {
  try {
    const callerId = req.body.From || 'Unknown';
    logger.info(`Incoming call received from ${callerId}`);

    const response = new VoiceResponse();
    const connect = response.connect();
    // Pass context and callerId to the stream
    const streamUrl = `wss://${req.headers.host}/voice/stream?direction=inbound&callerId=${encodeURIComponent(callerId)}`;

    const stream = connect.stream({
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
    const to = req.body.To; // The number we called
    logger.info(`Generating TwiML for outbound call to ${to} (Client ID: ${clientId})`);

    const response = new VoiceResponse();
    const connect = response.connect();
    // Pass context, clientId, and callerId (who we are talking to)
    const streamUrl = `wss://${req.headers.host}/voice/stream?direction=outbound&clientId=${clientId}&callerId=${encodeURIComponent(to)}`;

    const stream = connect.stream({
      url: streamUrl,
    });

    res.type('text/xml');
    res.send(response.toString());
  } catch (error) {
    logger.error('Error generating outbound TwiML:', error);
    res.status(500).send('Internal Server Error');
  }
};

export const statusCallback = (req, res) => {
  const callSid = req.body.CallSid;
  const status = req.body.CallStatus;

  logger.info(`Call ${callSid} status update: ${status}`);

  if (['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(status)) {
    onCallEnded();
  }

  res.sendStatus(200);
};

export const handleWebSocket = (ws, req) => {
  try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const params = Object.fromEntries(url.searchParams);

      logger.info('New WebSocket connection with params:', params);

      let callSid = 'unknown';

      const openAIService = new OpenAIRealtimeService(ws, callSid, params);
      openAIService.connect();

      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message);

          if (data.event === 'start') {
            callSid = data.start.callSid;
            openAIService.callSid = callSid;
            // Also update callSid in service if needed
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
  } catch (error) {
      logger.error('Error handling WebSocket connection:', error);
      ws.close();
  }
};
