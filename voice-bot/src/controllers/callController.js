import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { callEnded } from '../services/dripService.js';
import { URL } from 'url';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = (req, res) => {
  try {
    logger.info('Incoming call received');
    const callerId = req.body.From || 'unknown';
    const context = 'inbound'; // Default context

    const response = new VoiceResponse();
    const connect = response.connect();
    const stream = connect.stream({
      url: `wss://${req.headers.host}/voice/stream?context=${context}&callerId=${encodeURIComponent(callerId)}`,
    });

    res.type('text/xml');
    res.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    res.status(500).send('Internal Server Error');
  }
};

export const outboundTwiML = (req, res) => {
  try {
    const { context, callerId } = req.query;
    logger.info(`Generating TwiML for outbound call to ${callerId}`);

    const response = new VoiceResponse();
    const connect = response.connect();
    const stream = connect.stream({
        url: `wss://${req.headers.host}/voice/stream?context=${context || 'outbound'}&callerId=${encodeURIComponent(callerId || 'unknown')}`
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
    const callStatus = req.body.CallStatus;
    logger.info(`Call ${callSid} status update: ${callStatus}`);

    if (['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(callStatus)) {
        callEnded();
    }

    res.sendStatus(200);
};

export const handleWebSocket = (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const context = url.searchParams.get('context') || 'inbound';
  const callerId = url.searchParams.get('callerId') || 'unknown';

  logger.info(`New WebSocket connection. Context: ${context}, CallerID: ${callerId}`);

  let callSid = 'unknown';

  const openAIService = new OpenAIRealtimeService(ws, callSid, context, callerId);
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
