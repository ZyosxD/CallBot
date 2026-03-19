import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyFormbody from '@fastify/formbody';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
import { startDrip, stopDrip } from './services/dripService.js';

const fastify = Fastify({ logger: false }); // Disable built-in fastify logger, use winston

// Register Plugins
fastify.register(fastifyFormbody);
fastify.register(fastifyWebsocket);

// Register Routes
fastify.register(router);

// Global Error Handler
fastify.setErrorHandler((error, request, reply) => {
    logger.error(`Fastify Error: ${error.message}\n${error.stack}`);
    reply.status(500).send({ error: 'Internal Server Error' });
});

// Start the server
const startServer = async () => {
    try {
        if (!config.server.publicUrl) {
            logger.warn('WARNING: PUBLIC_URL environment variable is not set.');
        }

        const PORT = config.server.port;
        await fastify.listen({ port: PORT, host: '0.0.0.0' });
        logger.info(`Server is running on port ${PORT}`);

        // Start Drip Engine if publicUrl is present.
        if (config.server.publicUrl) {
            logger.info('Starting Drip Service...');
            startDrip();
        } else {
            logger.warn('Drip Service NOT started because PUBLIC_URL is missing.');
        }

    } catch (err) {
        logger.error(`Error starting server: ${err}`);
        process.exit(1);
    }
};

startServer();

// Handle graceful shutdown
process.on('SIGINT', async () => {
    logger.info('Shutting down server...');
    stopDrip();
    await fastify.close();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    logger.info('Shutting down server...');
    stopDrip();
    await fastify.close();
    process.exit(0);
});
