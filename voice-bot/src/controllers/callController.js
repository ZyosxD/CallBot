import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';
import eventBus from '../utils/events.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = (req, res) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();

    // Add direction=inbound to the stream URL
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

export const outboundCallTwiML = (req, res) => {
  try {
    const clientId = req.query.clientId;
    logger.info(`Generating TwiML for outbound call to client ${clientId}`);

    const response = new VoiceResponse();
    const connect = response.connect();

    // Add direction=outbound and clientId to the stream URL
    const streamUrl = `wss://${req.headers.host}/voice/stream?direction=outbound&clientId=${clientId}`;

    const stream = connect.stream({
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
  const callSid = req.body.CallSid;
  const callStatus = req.body.CallStatus;

  logger.info(`Call Status Update: ${callSid} -> ${callStatus}`);

  if (['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(callStatus)) {
    eventBus.emit('callEnded', { callSid, status: callStatus });
  }

  res.sendStatus(200);
};

export const handleWebSocket = (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const direction = url.searchParams.get('direction') || 'inbound';
  const clientId = url.searchParams.get('clientId');

  logger.info(`New WebSocket connection. Direction: ${direction}, ClientID: ${clientId}`);

  let callSid = 'unknown';

  // Initialize OpenAI Service with direction and clientId
  const openAIService = new OpenAIRealtimeService(ws, callSid, direction, clientId);
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
    // We can also emit callEnded here, but statusCallback is more reliable for Twilio call state.
    // However, if the WebSocket closes, the interaction is effectively over from AI perspective.
  });
};
