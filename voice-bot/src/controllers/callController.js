import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';
import fs from 'fs';
import path from 'path';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = (req, res) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();
    // Append direction=inbound
    const streamUrl = `wss://${req.headers.host}/voice/stream?direction=inbound`;
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

export const initiateOutboundCall = async (clientData) => {
    try {
        const client = twilio(config.twilio.accountSid, config.twilio.authToken);

        // Ensure we have a public URL. In production, this comes from ENV.
        // For local dev with ngrok, user must set PUBLIC_URL in .env
        let host = config.server.publicUrl;
        if (!host) {
             logger.warn('PUBLIC_URL is not set. Outbound calls may fail if Twilio cannot reach the stream URL.');
             host = 'localhost:3000'; // Fallback unlikely to work for Twilio
        }

        // Remove protocol if present for wss construction
        const cleanHost = host.replace(/^https?:\/\//, '');

        const streamUrl = `wss://${cleanHost}/voice/stream?direction=outbound&clientId=${clientData.id}`;

        const twiml = new VoiceResponse();
        twiml.connect().stream({ url: streamUrl });

        logger.info(`Dialing ${clientData.phone}...`);
        await client.calls.create({
            to: clientData.phone,
            from: config.twilio.phoneNumber,
            twiml: twiml.toString(),
        });
        return true;
    } catch (error) {
        logger.error(`Error initiating outbound call to ${clientData.phone}:`, error);
        return false;
    }
}

export const handleWebSocket = (ws, req) => {
  logger.info(`New WebSocket connection: ${req.url}`);

  // Parse query params
  // req.url looks like "/voice/stream?direction=inbound"
  // We use a dummy base to parse the relative URL
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const direction = url.searchParams.get('direction') || 'INBOUND';
  const clientId = url.searchParams.get('clientId');

  let clientData = null;
  if (direction === 'outbound' && clientId) {
      // Look up client details
      try {
          const clientsFile = path.resolve('clients.json');
          if (fs.existsSync(clientsFile)) {
              const clients = JSON.parse(fs.readFileSync(clientsFile, 'utf8'));
              clientData = clients.find(c => c.id == clientId);
          }
      } catch (e) {
          logger.error('Error looking up client:', e);
      }
  }

  let callSid = 'unknown';

  // Pass direction and clientData to Service
  const openAIService = new OpenAIRealtimeService(ws, callSid, direction.toUpperCase(), clientData);
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
