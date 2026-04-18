import { inboundCall, inboundStatus, handleWebSocket } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function router(fastify, options) {
    // POST /voice/inbound
    fastify.post('/inbound', { preHandler: validateTwilioRequest }, inboundCall);

    // POST /voice/inbound/status
    fastify.post('/inbound/status', { preHandler: validateTwilioRequest }, inboundStatus);

    // GET /voice/stream (Websocket)
    fastify.get('/stream', { websocket: true }, (connection, request) => {
        handleWebSocket(connection.socket ? connection.socket : connection, request);
    });
}