import Fastify from 'fastify';
import fastifyFormBody from '@fastify/formbody';
import fastifyWebSocket from '@fastify/websocket';
import { config } from './config/config.js';
import voiceRoutes from './routes/voiceRoutes.js';
import logger from './utils/logger.js';
import { startScheduler } from './services/scheduler.js';

const fastify = Fastify({ logger: true });

// Register plugins
fastify.register(fastifyFormBody);
fastify.register(fastifyWebSocket);

// Register routes
fastify.register(voiceRoutes);

// Error handling
fastify.setErrorHandler((error, request, reply) => {
  logger.error(error);
  reply.status(500).send({ error: 'Internal Server Error' });
});

// Start server
const start = async () => {
  try {
    const PORT = config.server.port || 3000;
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server is running on port ${PORT}`);

    // Start the scheduler
    startScheduler();

  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
