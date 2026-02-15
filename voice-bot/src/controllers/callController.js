import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';
import { notifyCallEnded } from '../services/dripService.js';
import { URL } from 'url';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = (req, res) => {
  try {
    logger.info('Incoming INBOUND call received');
    const response = new VoiceResponse();
    const connect = response.connect();
    // Pass context=inbound
    const stream = connect.stream({
      url: \`wss://\${req.headers.host}/voice/stream?context=inbound\`,
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
    logger.info(\`Generating TwiML for OUTBOUND call (Client ID: \${clientId})\`);

    const response = new VoiceResponse();
    const connect = response.connect();
    // Pass context=outbound and clientId
    const stream = connect.stream({
      url: \`wss://\${req.headers.host}/voice/stream?context=outbound&clientId=\${clientId}\`,
    });

    res.type('text/xml');
    res.send(response.toString());
  } catch (error) {
    logger.error('Error handling outbound TwiML:', error);
    res.status(500).send('Internal Server Error');
  }
};

export const callStatus = (req, res) => {
  const callStatus = req.body.CallStatus;
  const callSid = req.body.CallSid;

  logger.info(\`Call Status Update: \${callSid} is \${callStatus}\`);

  if (['completed', 'failed', 'busy', 'no-answer', 'canceled'].includes(callStatus)) {
    notifyCallEnded();
  }

  res.sendStatus(200);
};

export const handleWebSocket = (ws, req) => {
  // Parse query params from req.url
  const url = new URL(req.url, \`http://\${req.headers.host}\`);
  const context = url.searchParams.get('context') || 'inbound';
  const clientId = url.searchParams.get('clientId');

  logger.info(\`New WebSocket connection. Context: \${context}, ClientID: \${clientId}\`);

  let callSid = 'unknown';

  const openAIService = new OpenAIRealtimeService(ws, callSid, context, clientId);
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
        logger.info(\`Stream stopped for call \${callSid}\`);
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
    // Also ensure concurrency lock is released if socket closes unexpectedly
    // But notifyCallEnded is better handled by status callback
  });
};
