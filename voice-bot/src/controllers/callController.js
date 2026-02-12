import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { handleCallStatus as handleDripCallStatus } from '../services/dripService.js';
import { getClientById } from '../services/leadService.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const handleInboundCall = async (req, reply) => {
  try {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();

    const host = req.headers.host;
    const stream = connect.stream({
      url: `wss://${host}/voice/stream?direction=inbound&phone=${req.body.From || ''}`,
    });

    reply.type('text/xml');
    reply.send(response.toString());
  } catch (error) {
    logger.error('Error handling inbound call:', error);
    reply.code(500).send('Internal Server Error');
  }
};

export const handleOutboundTwiML = async (req, reply) => {
    try {
        const { clientId } = req.query;
        logger.info(`Generating TwiML for outbound call to client ${clientId}`);

        const response = new VoiceResponse();
        const connect = response.connect();
        const host = req.headers.host;

        const stream = connect.stream({
            url: `wss://${host}/voice/stream?direction=outbound&clientId=${clientId}`,
        });

        reply.type('text/xml');
        reply.send(response.toString());
    } catch (error) {
        logger.error('Error handling outbound TwiML:', error);
        reply.code(500).send('Internal Server Error');
    }
};

export const handleCallStatusWebhook = async (req, reply) => {
    const { CallSid, CallStatus } = req.body;
    logger.info(`Webhook: Call ${CallSid} is ${CallStatus}`);

    await handleDripCallStatus(CallSid, CallStatus);

    reply.send('OK');
};

export const handleWebSocket = async (connection, req) => {
    logger.info('New WebSocket connection');
    const ws = connection.socket;

    const query = req.query || {};
    const direction = query.direction || 'inbound';
    const clientId = query.clientId;
    const callerPhone = query.phone;

    let context = {
        type: direction,
        clientId: clientId,
        callerPhone: callerPhone
    };

    if (clientId) {
        const client = await getClientById(clientId);
        if (client) {
            context.clientName = client.name;
            context.callerPhone = client.phone;
        }
    }

    let callSid = 'unknown';

    const openAIService = new OpenAIRealtimeService(ws, callSid, context);
    openAIService.connect();

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.event === 'start') {
                callSid = data.start.callSid;
                openAIService.callSid = callSid;
                openAIService.handleTwilioMedia(data);
                logger.info(`Twilio Stream started for call ${callSid} (${direction})`);
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
