import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';
import { loadClients, callEnded } from '../services/dripService.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = (req, res) => {
    try {
        logger.info('Incoming call received');
        const response = new VoiceResponse();
        const connect = response.connect();
        const stream = connect.stream({
            url: `wss://${req.headers.host}/voice/stream`,
        });

        stream.parameter({
            name: 'context',
            value: 'inbound'
        });

        stream.parameter({
            name: 'phone',
            value: req.body.From || 'Unknown'
        });

        res.type('text/xml');
        res.send(response.toString());
    } catch (error) {
        logger.error('Error handling inbound call:', error);
        res.status(500).send('Internal Server Error');
    }
};

export const outboundCallTwiml = (req, res) => {
    try {
        const { clientId } = req.query;
        logger.info(`Generating TwiML for outbound call to client ${clientId}`);

        const response = new VoiceResponse();
        const connect = response.connect();
        const stream = connect.stream({
            url: `wss://${req.headers.host}/voice/stream`,
        });

        stream.parameter({
            name: 'context',
            value: 'outbound'
        });

        stream.parameter({
            name: 'clientId',
            value: clientId
        });

        res.type('text/xml');
        res.send(response.toString());

    } catch (error) {
        logger.error('Error generating outbound TwiML:', error);
        res.status(500).send('Internal Server Error');
    }
};

export const callStatusCallback = (req, res) => {
    const { CallSid, CallStatus } = req.body;
    logger.info(`Call Status Update: ${CallSid} -> ${CallStatus}`);

    if (['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(CallStatus)) {
        callEnded(); // Release the drip lock
    }

    res.sendStatus(200);
};

export const handleWebSocket = (ws, req) => {
    logger.info('New WebSocket connection');
    let callSid = 'unknown';
    let openAIService = null;

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);

            if (data.event === 'start') {
                callSid = data.start.callSid;
                const customParams = data.start.customParameters || {};
                const context = customParams.context || 'inbound';
                let clientData = {};

                if (context === 'outbound' && customParams.clientId) {
                    const clients = loadClients();
                    const client = clients.find(c => c.id === customParams.clientId);
                    if (client) {
                        clientData = client;
                    }
                } else {
                    // Inbound: try to infer from phone number
                    clientData = {
                        phone: customParams.phone || 'Unknown'
                    };
                }

                logger.info(`Initializing OpenAI Service for ${context} call (SID: ${callSid})`);
                openAIService = new OpenAIRealtimeService(ws, callSid, context, clientData);
                await openAIService.connect();
                openAIService.handleTwilioMedia(data);

            } else if (data.event === 'media') {
                if (openAIService) {
                    openAIService.handleTwilioMedia(data);
                }
            } else if (data.event === 'stop') {
                logger.info(`Stream stopped for call ${callSid}`);
                if (openAIService && openAIService.openaiWs) {
                    openAIService.openaiWs.close();
                }
                ws.close();
            }
        } catch (error) {
            logger.error('Error processing WebSocket message:', error);
        }
    });

    ws.on('close', () => {
        logger.info('WebSocket connection closed');
        if (openAIService && openAIService.openaiWs) {
            openAIService.openaiWs.close();
        }
    });
};
