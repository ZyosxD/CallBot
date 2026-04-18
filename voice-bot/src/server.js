import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyFormbody from '@fastify/formbody';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
import { stopDrip, startDrip } from './services/dripService.js';

const fastify = Fastify({ logger: false });

async function build() {
    await fastify.register(fastifyFormbody);
    await fastify.register(fastifyWebsocket);

    await fastify.register(router, { prefix: '/voice' });

    fastify.setErrorHandler((error, request, reply) => {
        logger.error(error.stack);
        reply.status(500).send('Something broke!');
    });

    fastify.addHook('onClose', (instance, done) => {
        stopDrip();
        done();
    });

    return fastify;
}

const PORT = config.server.port;

const start = async () => {
    try {
        const server = await build();
        await server.listen({ port: PORT, host: '0.0.0.0' });
        logger.info(`Server is running on port ${PORT}`);
        startDrip();

        // Handle graceful shutdown
        const listeners = ['SIGINT', 'SIGTERM'];
        listeners.forEach((signal) => {
            process.on(signal, async () => {
                await server.close();
                process.exit(0);
            });
        });
    } catch (err) {
        logger.error(err);
        process.exit(1);
    }
};

start();
