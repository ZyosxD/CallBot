import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyFormbody from '@fastify/formbody';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
import { startDrip, stopDrip } from './services/dripService.js';

const fastify = Fastify({ logger: false });

// Middleware/Plugins
fastify.register(fastifyFormbody);
fastify.register(fastifyWebsocket);

// Routes
fastify.register(router, { prefix: '/voice' });

// Error handling inside Fastify is mostly built-in, but we can hook into it
fastify.setErrorHandler((error, request, reply) => {
  logger.error(error.stack);
  reply.status(500).send('Something broke!');
});

fastify.addHook('onClose', (instance, done) => {
    stopDrip();
    done();
});

// Start server
const start = async () => {
    try {
        const PORT = config.server.port;
        await fastify.listen({ port: PORT, host: '0.0.0.0' });
        logger.info(`Fastify server is running on port ${PORT}`);
        startDrip();
    } catch (err) {
        logger.error(err);
        process.exit(1);
    }
};

start();

// Graceful shutdown
const gracefulShutdown = () => {
    logger.info('Shutting down server gracefully...');
    fastify.close().then(() => {
        logger.info('Server closed');
        process.exit(0);
    }, (err) => {
        logger.error('Error during shutdown', err);
        process.exit(1);
    });
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
