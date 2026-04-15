import fastify from 'fastify';
import fastifyFormbody from '@fastify/formbody';
import fastifyWebsocket from '@fastify/websocket';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
import { startDrip, stopDrip } from './services/dripService.js';

const app = fastify({ logger: false });

// Register plugins
app.register(fastifyFormbody);
app.register(fastifyWebsocket);

// Register routes
app.register(router, { prefix: '/voice' });

// Global error handler
app.setErrorHandler((error, request, reply) => {
  logger.error('Fastify Error:', error);
  reply.status(500).send('Internal Server Error');
});

// Graceful shutdown logic
const gracefulShutdown = async (signal) => {
  logger.info(`Received ${signal}, starting graceful shutdown...`);
  await app.close();
  process.exit(0);
};

app.addHook('onClose', async (instance, done) => {
  stopDrip();
  done();
});

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Start server
const start = async () => {
  try {
    const PORT = config.server.port;
    await app.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server is running on port ${PORT}`);
    startDrip();
  } catch (err) {
    logger.error('Error starting server:', err);
    process.exit(1);
  }
};

start();
