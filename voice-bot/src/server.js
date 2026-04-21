import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import websocket from '@fastify/websocket';
import { config } from './config/config.js';
import router from './controllers/router.js';
import { handleWebSocket } from './controllers/callController.js';
import logger from './utils/logger.js';
import { startDrip, stopDrip } from './services/dripService.js';

const fastify = Fastify({
  logger: false // Disable Fastify's built-in logger to use our custom Winston logger exclusively
});

// Register plugins
fastify.register(formbody);
fastify.register(websocket);

// Error handling
fastify.setErrorHandler(function (error, request, reply) {
  logger.error(error.stack);
  reply.status(500).send('Something broke!');
});

// Register routes
fastify.register(async function (app) {
    app.register(router, { prefix: '/voice' });

    // WebSocket route
    app.get('/voice/stream', { websocket: true }, (connection, req) => {
        handleWebSocket(connection, req);
    });
});

// Graceful shutdown hooks
fastify.addHook('onClose', (instance, done) => {
    logger.info('Server shutting down, stopping Smart Drip...');
    stopDrip();
    done();
});

const startServer = async () => {
    try {
        const PORT = config.server.port;
        // Listen on all interfaces to work in environments like Docker/AWS
        await fastify.listen({ port: PORT, host: '0.0.0.0' });
        logger.info(`Server is running on port ${PORT}`);

        // Start the Smart Drip engine after server starts successfully
        startDrip();
    } catch (err) {
        logger.error('Error starting server:', err);
        process.exit(1);
    }
};

startServer();

// Handle process termination to trigger graceful shutdown
process.on('SIGINT', async () => {
    logger.info('Received SIGINT');
    await fastify.close();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM');
    await fastify.close();
    process.exit(0);
});
