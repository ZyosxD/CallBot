import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyFormbody from '@fastify/formbody';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
import { startDrip, stopDrip } from './services/dripService.js';

const fastify = Fastify({ logger: false });

// Register plugins
fastify.register(fastifyFormbody);
fastify.register(fastifyWebsocket, {
    options: { maxPayload: 1048576 }
});

// Register routes
fastify.register(router, { prefix: '/voice' });

// Graceful shutdown hooks
const handleShutdown = async (signal) => {
    logger.info(`Received ${signal}. Shutting down gracefully...`);
    await fastify.close();
    process.exit(0);
};

process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);

fastify.addHook('onClose', (instance, done) => {
    stopDrip();
    done();
});

// Error handling
fastify.setErrorHandler((error, request, reply) => {
    logger.error(`Error: ${error.message}\n${error.stack}`);
    reply.status(500).send({ error: 'Internal Server Error' });
});

// Start server
const start = async () => {
    try {
        const PORT = config.server.port;
        await fastify.listen({ port: PORT, host: '0.0.0.0' });
        logger.info(`Server is running on port ${PORT}`);
        startDrip();
    } catch (err) {
        logger.error(err);
        process.exit(1);
    }
};

start();
