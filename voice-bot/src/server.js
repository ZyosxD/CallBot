import Fastify from 'fastify';
import formBody from '@fastify/formbody';
import websocket from '@fastify/websocket';
import { config } from './config/config.js';
import logger from './utils/logger.js';
import voiceRoutes from './routes/voiceRoutes.js';
import { startScheduler } from './services/scheduler.js';

const fastify = Fastify({
  logger: true // Fastify has built-in logger, but we can also use our winston logger if we pass it, or just let fastify log requests.
});

// Plugins
await fastify.register(formBody);
await fastify.register(websocket);

// Routes
await fastify.register(voiceRoutes, { prefix: '/voice' });

// Global Error Handler
fastify.setErrorHandler((error, request, reply) => {
  logger.error(error.message);
  reply.status(500).send({ error: 'Something broke!' });
});

// Start server
const start = async () => {
  try {
    const PORT = config.server.port;
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server is running on port ${PORT}`);

    // Start Drip Scheduler
    startScheduler();
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

start();
