import Fastify from 'fastify';
import fastifyFormBody from '@fastify/formbody';
import fastifyWebsocket from '@fastify/websocket';
import { config } from './config/config.js';
import logger from './utils/logger.js';
import {
    handleInboundCall,
    handleOutboundTwiML,
    handleWebSocket,
    handleStatusCallback
} from './controllers/callController.js';
import { startDrip } from './services/dripService.js';

const fastify = Fastify({ logger: true });

// Register plugins
fastify.register(fastifyFormBody);
fastify.register(fastifyWebsocket);

// Routes
fastify.register(async (fastify) => {
    fastify.post('/voice/incoming', handleInboundCall);
    fastify.post('/voice/outbound-twiml', handleOutboundTwiML);
    fastify.post('/voice/status', handleStatusCallback);

    fastify.get('/voice/stream', { websocket: true }, handleWebSocket);
});

// Start server
const start = async () => {
    try {
        if (!config.server.publicUrl) {
            logger.warn('WARNING: PUBLIC_URL is not set. Outbound calls callback will fail.');
        }

        await fastify.listen({ port: config.server.port, host: '0.0.0.0' });
        logger.info(`Server is running on port ${config.server.port}`);

        // Start Drip Service
        startDrip();

    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();
