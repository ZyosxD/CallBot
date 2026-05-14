import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyFormbody from '@fastify/formbody';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
import { startDrip, stopDrip } from './services/dripService.js';

const fastify = Fastify({
  logger: false // We use our custom Winston logger
});

// Register plugins
fastify.register(fastifyFormbody);
fastify.register(fastifyWebsocket);

// Register routes
fastify.register(router, { prefix: '/voice' });

// Global error handler
fastify.setErrorHandler((error, request, reply) => {
  logger.error('Fastify error:', error);
  reply.status(500).send('Internal Server Error');
});

// Graceful Shutdown
const closeGracefully = async (signal) => {
    logger.info(`Received signal to terminate: ${signal}`);
    await fastify.close();
    process.exit(0);
};

process.on('SIGINT', closeGracefully);
process.on('SIGTERM', closeGracefully);

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

    // Start Smart Drip Engine
    startDrip();

  } catch (err) {
    logger.error('Error starting server:', err);
    process.exit(1);
  }
};

start();
