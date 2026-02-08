import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';
import { eventBus } from '../utils/events.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = (req, res) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();
    const stream = connect.stream({
      url: `wss://${req.headers.host}/voice/stream?direction=inbound`,
    });

    res.type('text/xml');
    res.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    res.status(500).send('Internal Server Error');
  }
};

export const outboundCall = async (req, res) => {
  try {
    const { clientId } = req.query;
    if (!clientId) {
      return res.status(400).send('Missing clientId');
    }
    logger.info(`Generating TwiML for outbound call to client ${clientId}`);
    const response = new VoiceResponse();
    const connect = response.connect();
    const stream = connect.stream({
      url: `wss://${req.headers.host}/voice/stream?direction=outbound&clientId=${clientId}`,
    });

    res.type('text/xml');
    res.send(response.toString());
  } catch (error) {
    logger.error('Error handling outbound call TwiML:', error);
    res.status(500).send('Internal Server Error');
  }
};

export const initiateOutboundCall = async (client) => {
  try {
    const clientTwilio = twilio(config.twilio.accountSid, config.twilio.authToken);
    // Ensure publicUrl does not end with slash
    const publicUrl = config.server.publicUrl.replace(/\/$/, '');
    const callbackUrl = `${publicUrl}/voice/outbound?clientId=${client.id}`;

    logger.info(`Initiating call to ${client.phone} with callback ${callbackUrl}`);

    const call = await clientTwilio.calls.create({
      url: callbackUrl,
      to: client.phone,
      from: config.twilio.phoneNumber,
      machineDetection: 'Enable',
    });

    logger.info(`Outbound call initiated: ${call.sid}`);
    return call;
  } catch (error) {
    logger.error(`Error initiating outbound call to ${client.phone}:`, error);
    throw error;
  }
};

export const handleWebSocket = (ws, req) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const direction = url.searchParams.get('direction') || 'inbound';
    const clientId = url.searchParams.get('clientId');

    logger.info(`New WebSocket connection: direction=${direction}, clientId=${clientId}`);

    let callSid = 'unknown';

    // We can pass clientId to OpenAIRealtimeService if needed
    const openAIService = new OpenAIRealtimeService(ws, callSid, direction);
    openAIService.connect();

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);

        if (data.event === 'start') {
          callSid = data.start.callSid;
          openAIService.callSid = callSid;
          openAIService.handleTwilioMedia(data);
          logger.info(`Stream started for call ${callSid}`);
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

      // If it was an outbound call, emit an event so dripService can proceed
      if (direction === 'outbound') {
        eventBus.emit('callEnded', { callSid, clientId });
      }
    });
  } catch (error) {
    logger.error('Error in handleWebSocket:', error);
    ws.close();
  }
};
