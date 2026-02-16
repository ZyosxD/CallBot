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

    // Pass callerId (From) as a custom parameter to the stream
    stream.parameter({
        name: 'callerId',
        value: req.body.From
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
        logger.info(`Generating TwiML for outbound call to client ${clientId}`);

        const response = new VoiceResponse();
        const connect = response.connect();
        const stream = connect.stream({
            url: `wss://${req.headers.host}/voice/stream?clientId=${clientId}&direction=outbound`,
        });

        // We can also pass parameters inside the stream element for the WebSocket "start" event
        stream.parameter({
            name: 'clientId',
            value: clientId
        });
        stream.parameter({
            name: 'direction',
            value: 'outbound'
        });
        // Pass the called number as callerId for the bot context (or who we are calling)
        stream.parameter({
            name: 'callerId',
            value: req.body.To // 'To' is the number we called
        });


        res.type('text/xml');
        res.send(response.toString());
    } catch (error) {
        logger.error('Error generating outbound TwiML:', error);
        res.status(500).send('Internal Server Error');
    }
};

export const statusCallback = (req, res) => {
    const status = req.body.CallStatus;
    logger.info(`Call status update: ${status}`);
    if (['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(status)) {
        callEnded();
    }
    res.sendStatus(200);
};

export const handleWebSocket = (ws, req) => {
  logger.info('New WebSocket connection');

  // Extract query params
  // req.url starts with /voice/stream?clientId=...
  const url = new URL(req.url, `http://${req.headers.host}`);
  const clientId = url.searchParams.get('clientId');
  const direction = url.searchParams.get('direction') || 'inbound';

  let callSid = 'unknown';

  const clientData = {
      clientId,
      direction,
      callerId: null // Will be populated from start event
  };

  const openAIService = new OpenAIRealtimeService(ws, callSid, clientData);
  openAIService.connect();

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;
        openAIService.callSid = callSid;

        // Extract custom parameters
        if (data.start.customParameters) {
            if (data.start.customParameters.callerId) {
                openAIService.clientData.callerId = data.start.customParameters.callerId;
            }
        }

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
    callEnded(); // Notify Drip Service
    if (openAIService.openaiWs) {
        openAIService.openaiWs.close();
    }
  });
};
