import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';
import { callEnded } from '../services/dripService.js';
import { URL } from 'url';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = (req, res) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();
    const stream = connect.stream({
      url: `wss://${req.headers.host}/voice/stream`,
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
    const { clientId, clientName, company, callerId } = req.query;
    logger.info(`Generating Outbound TwiML for Client: ${clientName} (${company})`);

    const response = new VoiceResponse();
    const connect = response.connect();

    // Pass client data as query params to the WebSocket URL
    // Ensure we handle special characters in names/companies
    const streamUrl = `wss://${req.headers.host}/voice/stream?clientId=${clientId}&clientName=${encodeURIComponent(clientName || '')}&company=${encodeURIComponent(company || '')}&phone=${encodeURIComponent(callerId || '')}`;

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

export const handleWebSocket = (ws, req) => {
  logger.info('New WebSocket connection');

  // Parse query params to get client data
  const url = new URL(req.url, `http://${req.headers.host}`);
  const clientData = {
    clientId: url.searchParams.get('clientId'),
    name: url.searchParams.get('clientName'),
    company: url.searchParams.get('company'),
    phone: url.searchParams.get('phone')
  };

  let callSid = 'unknown';

  // Instantiate service with client data
  const openAIService = new OpenAIRealtimeService(ws, callSid, clientData);
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
    // Notify Drip Service that call ended
    callEnded();
  });
};
