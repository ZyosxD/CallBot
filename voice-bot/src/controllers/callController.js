import { OpenAIRealtimeService } from '../services/openaiRealtime.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { markCallEnded } from '../services/dripService.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const inboundCall = async (request, reply) => {
    try {
        logger.info('Incoming/Outbound call routed');

        const isOutboundApi = request.body?.Direction === 'outbound-api';

        const callerId = isOutboundApi ? request.body?.To : request.body?.From;
        const mode = isOutboundApi ? 'OUTBOUND' : 'INBOUND';

        const response = new VoiceResponse();
        const connect = response.connect();
        const stream = connect.stream({
            url: `wss://${request.headers.host}/voice/stream`,
        });

        // Add parameters sequentially to avoid chaining errors
        stream.parameter({ name: 'callerId', value: callerId || 'Unknown' });
        stream.parameter({ name: 'mode', value: mode });

        return reply.type('text/xml').send(response.toString());
    } catch (error) {
        logger.error('Error handling inbound call:', error);
        return reply.code(500).send('Internal Server Error');
    }
};

export const inboundStatus = async (request, reply) => {
    try {
        const callSid = request.body?.CallSid;
        const status = request.body?.CallStatus;

        logger.info(`Call status update: ${status} for Sid: ${callSid}`);

        if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(status)) {
             await markCallEnded(callSid);
        }

        return reply.code(200).send();
    } catch (error) {
        logger.error('Error handling inbound status:', error);
        return reply.code(500).send('Internal Server Error');
    }
};

export const handleWebSocket = (connection, req) => {
    const ws = connection.socket ? connection.socket : connection;
    logger.info('New WebSocket connection');

    let callSid = 'unknown';
    let callerId = 'unknown';
    let mode = 'INBOUND';
    let openAIService = null;

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);

            if (data.event === 'start') {
                callSid = data.start.callSid;
                callerId = data.start.customParameters?.callerId || 'unknown';
                mode = data.start.customParameters?.mode || 'INBOUND';

                logger.info(`Stream start detected. CallSid: ${callSid}, CallerId: ${callerId}, Mode: ${mode}`);

                openAIService = new OpenAIRealtimeService(ws, callSid, callerId, mode);
                openAIService.connect();

                openAIService.handleTwilioMedia(data);
            } else if (data.event === 'media' && openAIService) {
                openAIService.handleTwilioMedia(data);
            } else if (data.event === 'stop') {
                logger.info(`Stream stopped for call ${callSid}`);
                await markCallEnded(callSid);
                ws.close();
            }
        } catch (error) {
            logger.error('Error processing WebSocket message:', error);
        }
    });

    ws.on('close', async () => {
        logger.info('WebSocket connection closed');
        if (openAIService && openAIService.openaiWs) {
            openAIService.openaiWs.close();
        }
        await markCallEnded(callSid);
    });
};
