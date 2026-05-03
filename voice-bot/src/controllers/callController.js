import twilio from 'twilio';
import logger from '../utils/logger.js';
import { OpenAIRealtimeService } from '../services/openaiRealtime.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = (req, res) => {
  try {
    const isOutbound = req.body?.Direction === 'outbound-api';
    logger.info(`Incoming Webhook. Direction: ${req.body?.Direction || 'inbound'}`);

    // TwiML for connecting to WebSocket stream
    const response = new VoiceResponse();
    const connect = response.connect();

    const stream = connect.stream({
      url: `wss://${req.headers.host}/voice/stream`,
    });

    // In outbound mode, the callerId we want to track is the 'To' number
    // In inbound mode, the callerId is the 'From' number
    const callerId = isOutbound ? (req.body?.To || 'Unknown') : (req.body?.From || 'Unknown');
    const mode = isOutbound ? 'outbound' : 'inbound';

    stream.parameter({
        name: 'callerId',
        value: callerId
    });

    stream.parameter({
        name: 'mode',
        value: mode
    });

    res.type('text/xml');
    res.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    res.status(500).send('Internal Server Error');
  }
};

export const inboundStatus = async (req, res) => {
    try {
        const status = req.body?.CallStatus;
        const callSid = req.body?.CallSid;

        logger.info(`Call Status Webhook received: ${status} for CallSid: ${callSid}`);

        // Terminal statuses
        if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(status)) {
            // Dynamically import markCallEnded to release the drip lock
            const { markCallEnded } = await import('../services/dripService.js');
            markCallEnded(callSid);
        }

        res.status(200).send('OK');
    } catch (error) {
        logger.error('Error handling inbound status webhook:', error);
        res.status(500).send('Internal Server Error');
    }
};

export const handleWebSocket = (connection, req) => {
  logger.info('New WebSocket connection initiated');

  const ws = connection.socket ? connection.socket : connection;

  let callSid = 'unknown';
  let callerId = 'unknown';
  let mode = 'unknown';

  const openAIService = new OpenAIRealtimeService(ws, callSid, callerId, mode);
  openAIService.connect();

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        callSid = data.start.callSid || 'unknown';
        openAIService.callSid = callSid;

        if (data.start.customParameters) {
            callerId = data.start.customParameters.callerId || callerId;
            mode = data.start.customParameters.mode || mode;
            openAIService.callerId = callerId;
            openAIService.mode = mode;
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

  ws.on('close', async () => {
    logger.info('WebSocket connection closed');
    if (openAIService.openaiWs) {
        openAIService.openaiWs.close();
    }

    // Release lock just in case the status webhook is missed or delayed
    if (callSid !== 'unknown') {
        try {
            const { markCallEnded } = await import('../services/dripService.js');
            markCallEnded(callSid);
        } catch (e) {
            logger.error('Failed to import dripService for markCallEnded on ws close', e);
        }
    }
  });
};
