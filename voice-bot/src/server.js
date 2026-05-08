import Fastify from 'fastify';
import fastifyFormbody from '@fastify/formbody';
import fastifyWebsocket from '@fastify/websocket';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
import { startDrip, stopDrip } from './services/dripService.js';

const fastify = Fastify({ logger: false });

// Register plugins
fastify.register(fastifyFormbody);
fastify.register(fastifyWebsocket);

// Register routes
fastify.register(router, { prefix: '/voice' });

fastify.setErrorHandler((error, request, reply) => {
  logger.error(error);
  reply.status(500).send('Something broke!');
});

fastify.addHook('onClose', (instance, done) => {
    logger.info('Fastify server shutting down...');
    stopDrip();
    done();
});

const startServer = async () => {
    try {
        const PORT = config.server.port;
        await fastify.listen({ port: PORT, host: '0.0.0.0' });
        logger.info(`Server is running on port ${PORT}`);

        // Start the Drip Campaign engine
        startDrip();

    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

startServer();

// Graceful shutdown handling
const gracefulShutdown = () => {
    fastify.close().then(() => {
        logger.info('Graceful shutdown complete');
        process.exit(0);
    });
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
