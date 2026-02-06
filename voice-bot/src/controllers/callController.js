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
    // Add type=inbound to the stream URL so the WebSocket knows which persona to load
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

export const outboundCall = (req, res) => {
  try {
    logger.info('Outbound call connected, starting stream...');
    const response = new VoiceResponse();
    const connect = response.connect();
    // Add type=outbound to the stream URL
    const stream = connect.stream({
      url: `wss://${req.headers.host}/voice/stream?type=outbound`,
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

  // Parse query parameters to determine call type
  let callType = 'outbound';
  try {
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    callType = parsedUrl.searchParams.get('type') || 'outbound';
  } catch (error) {
    logger.warn('Failed to parse WebSocket URL params, defaulting to outbound:', error);
  }

  logger.info(`Initializing OpenAI Service with call type: ${callType}`);

  let callSid = 'unknown';

  const openAIService = new OpenAIRealtimeService(ws, callSid, callType);
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
