import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';
import { URL } from 'url';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = (req, res) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();
    // Construct WebSocket URL
    const host = req.headers.host;
    const streamUrl = `wss://${host}/voice/stream?direction=inbound`;

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
        logger.info('Outbound call connected, initiating stream');
        const clientId = req.query.clientId;
        const phone = req.query.phone;
        const response = new VoiceResponse();
        const connect = response.connect();
        const host = req.headers.host;
        let streamUrl = `wss://${host}/voice/stream?direction=outbound&clientId=${clientId}`;
        if (phone) {
            streamUrl += `&phone=${encodeURIComponent(phone)}`;
        }

        connect.stream({
            url: streamUrl
        });

        res.type('text/xml');
        res.send(response.toString());

    } catch (error) {
        logger.error('Error handling outbound call:', error);
        res.status(500).send('Internal Server Error');
    }
};

export const handleWebSocket = (ws, req) => {
  logger.info('New WebSocket connection');

  // Parse query params
  const url = new URL(req.url, `http://${req.headers.host}`);
  const direction = url.searchParams.get('direction') || 'outbound';
  const clientId = url.searchParams.get('clientId');
  const phone = url.searchParams.get('phone');

  let callSid = 'unknown';

  const callDetails = {
      direction,
      clientId,
      phoneNumber: phone || null
  };

  const openAIService = new OpenAIRealtimeService(ws, callSid, callDetails);
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
