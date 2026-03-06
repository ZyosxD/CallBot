import { inboundCall, handleWebSocket, handleStatusCallback } from './callController.js';
import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

export default async function (fastify, options) {
    // Twilio Webhook Validation Middleware
    const validateTwilioRequest = (request, reply, done) => {
        const twilioSignature = request.headers['x-twilio-signature'];
        const url = `${config.server.publicUrl}${request.raw.url}`;
        const params = request.body || {};

        if (!twilioSignature) {
            logger.warn('Missing Twilio signature');
            return reply.status(403).send('Forbidden');
        }

        const isValid = twilio.validateRequest(
            config.twilio.authToken,
            twilioSignature,
            url,
            params
        );

        if (!isValid) {
            logger.warn('Invalid Twilio signature');
            return reply.status(403).send('Forbidden');
        }

        done();
    };

    fastify.post('/inbound', { preHandler: validateTwilioRequest }, (request, reply) => {
        return inboundCall(request, reply);
    });

    fastify.post('/status-callback', { preHandler: validateTwilioRequest }, (request, reply) => {
        return handleStatusCallback(request, reply);
    });

    // Websocket route for stream
    fastify.get('/stream', { websocket: true }, (connection, req) => {
        handleWebSocket(connection.socket, req);
    });
}