import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = (req, res) => {
  try {
    logger.info(`Incoming call from ${req.body.From}`);
    const response = new VoiceResponse();
    const connect = response.connect();
    const stream = connect.stream({
      url: `wss://${req.headers.host}/voice/stream`,
    });

    stream.parameter({
        name: 'mode',
        value: 'inbound'
    });

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

export const outboundCall = async (to) => {
    try {
        const client = twilio(config.twilio.accountSid, config.twilio.authToken);

        // Remove protocol to get just the host
        let host = config.server.publicUrl;
        if (host) {
            host = host.replace('https://', '').replace('http://', '');
        } else {
             logger.warn("PUBLIC_URL not set, outbound call might fail if stream url is incorrect");
        }

        const wsUrl = `wss://${host}/voice/stream`;

        const response = new VoiceResponse();
        const connect = response.connect();
        const stream = connect.stream({
            url: wsUrl
        });

        stream.parameter({
            name: 'mode',
            value: 'outbound'
        });

        stream.parameter({
            name: 'callerId',
            value: to
        });

        // Also add statusCallback to release the lock in dripService when call ends
        const statusCallbackUrl = `${config.server.publicUrl}/voice/status-callback`;

        const call = await client.calls.create({
            to: to,
            from: config.twilio.phoneNumber,
            twiml: response.toString(),
            statusCallback: statusCallbackUrl,
            statusCallbackEvent: ['completed', 'busy', 'no-answer', 'failed', 'canceled']
        });

        logger.info(`Initiated outbound call to ${to}: ${call.sid}`);
        return call.sid;
    } catch (error) {
        logger.error(`Error initiating outbound call to ${to}:`, error);
        throw error;
    }
};

export const callStatusCallback = (req, res) => {
    const callSid = req.body.CallSid;
    const callStatus = req.body.CallStatus;
    logger.info(`Call Status Update: ${callSid} -> ${callStatus}`);

    // We will handle the lock release via an event emitter or a shared service if needed
    // For now, let's just acknowledge the callback
    // Ideally dripService should listen to this, but simpler: dripService polls or waits.
    // The master spec says: "Espera a que termine esa llamada por completo antes de buscar el siguiente."
    // So dripService needs to know when the call ends.
    // I'll emit an event here.

    import('../services/dripService.js').then(module => {
        if (module.handleCallEnded) {
            module.handleCallEnded(callSid);
        }
    }).catch(err => logger.error('Error importing dripService', err));

    res.sendStatus(200);
};

export const handleWebSocket = (ws, req) => {
  logger.info('New WebSocket connection');

  let callSid = 'unknown';
  let openAIService = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid;
        const customParams = data.start.customParameters;
        const mode = (customParams && customParams.mode) ? customParams.mode : 'inbound';
        const callerId = (customParams && customParams.callerId) ? customParams.callerId : 'unknown';

        logger.info(`Call started: ${callSid}, Mode: ${mode}, CallerID: ${callerId}`);

        openAIService = new OpenAIRealtimeService(ws, callSid, mode, callerId);
        openAIService.connect();
        openAIService.handleTwilioMedia(data);
      } else if (data.event === 'media') {
        if (openAIService) {
            openAIService.handleTwilioMedia(data);
        }
      } else if (data.event === 'stop') {
        logger.info(`Stream stopped for call ${callSid}`);
        ws.close();
      }
    } catch (error) {
      logger.error('Error processing WebSocket message:', error);
    }
  });

  ws.on('close', () => {
    logger.info(`WebSocket connection closed for call ${callSid}`);
    if (openAIService && openAIService.openaiWs) {
        openAIService.openaiWs.close();
    }
  });
};
