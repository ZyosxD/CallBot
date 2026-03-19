import { inboundCall, handleWebSocket, statusCallback } from './callController.js';
import { validateTwilioRequest } from '../utils/twilioValidator.js';

export default async function router(fastify, options) {
    // We register under /voice prefix inside this plugin if we want,
    // but the original code had `app.use('/voice', router);`
    // Let's explicitly define paths with /voice here.

    // POST /voice/inbound
    fastify.post('/voice/inbound', { preHandler: validateTwilioRequest }, inboundCall);

    // GET /voice/stream
    fastify.get('/voice/stream', { websocket: true }, (connection, req) => {
        handleWebSocket(connection, req);
    });

    // POST /voice/status-callback
    fastify.post('/voice/status-callback', { preHandler: validateTwilioRequest }, statusCallback);
}
