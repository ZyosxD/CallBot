import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';
import { handleCallEnded } from '../services/dripService.js';
import { getClientById } from '../services/leadService.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const handleInboundCall = async (req, reply) => {
    logger.info('Incoming call received');
    const response = new VoiceResponse();
    const connect = response.connect();
    const stream = connect.stream({
        url: `wss://${req.headers.host}/voice/stream?direction=inbound`
    });

    reply.type('text/xml').send(response.toString());
};

export const handleOutboundTwiML = async (req, reply) => {
    const { clientId } = req.query;
    logger.info(`Generating TwiML for outbound call to client ${clientId}`);

    const response = new VoiceResponse();
    const connect = response.connect();
    // Pass clientId to the stream so we can look it up in the websocket handler
    const stream = connect.stream({
        url: `wss://${req.headers.host}/voice/stream?direction=outbound&clientId=${clientId}`
    });

    reply.type('text/xml').send(response.toString());
};

export const handleStatusCallback = async (req, reply) => {
    const { CallStatus, CallSid } = req.body;
    logger.info(`Call Status Update: ${CallSid} -> ${CallStatus}`);

    if (['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(CallStatus)) {
        handleCallEnded();
    }

    reply.send({ status: 'ok' });
};

export const handleWebSocket = async (connection, req) => {
    logger.info('New WebSocket connection');
    let callSid = 'unknown';
    let clientData = {};

    // Parse query params from req.url
    // Fastify request object has `url` property which is the path
    const url = new URL(req.url, `http://${req.headers.host}`);
    const clientId = url.searchParams.get('clientId');
    // const direction = url.searchParams.get('direction');

    if (clientId) {
        clientData = await getClientById(clientId) || {};
        logger.info(`Identified Client: ${clientData.name}`);
    } else {
        // Inbound call - could look up by caller number if needed, but for now generic
        clientData = { name: "Unknown Caller", phone: "Unknown" };
    }

    const openAIService = new OpenAIRealtimeService(connection.socket, callSid, clientData);
    openAIService.connect();

    connection.socket.on('message', (message) => {
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
                connection.socket.close();
            }
        } catch (error) {
            logger.error('Error processing WebSocket message:', error);
        }
    });

    connection.socket.on('close', () => {
        logger.info('WebSocket connection closed');
        if (openAIService.openaiWs) {
            openAIService.openaiWs.close();
        }
    });
};
