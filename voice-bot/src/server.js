import Fastify from 'fastify';
import fastifyFormbody from '@fastify/formbody';
import fastifyWebsocket from '@fastify/websocket';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
import { startDrip, stopDrip } from './services/dripService.js';

const fastify = Fastify({ logger: false });

fastify.register(fastifyFormbody);
fastify.register(fastifyWebsocket);

fastify.register(router, { prefix: '/voice' });

fastify.addHook('onClose', (instance, done) => {
    stopDrip();
    done();
});

const startServer = async () => {
    try {
        await fastify.listen({ port: config.server.port, host: '0.0.0.0' });
        logger.info(`Fastify Server is running on port ${config.server.port}`);

        // Start Outbound Drip Engine
        startDrip();

        // Graceful shutdown
        const gracefulShutdown = () => {
            logger.info('Received shutdown signal, closing server...');
            fastify.close().then(() => {
                logger.info('Server closed gracefully');
                process.exit(0);
            });
        };
        process.on('SIGINT', gracefulShutdown);
        process.on('SIGTERM', gracefulShutdown);

    } catch (err) {
        logger.error(err);
        process.exit(1);
    }
};

startServer();
