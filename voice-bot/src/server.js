import fastify from 'fastify';
import formbody from '@fastify/formbody';
import websocket from '@fastify/websocket';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
import { startDrip, stopDrip } from './services/dripService.js';

const app = fastify({ logger: false }); // Use winston instead

// Register plugins
app.register(formbody);
app.register(websocket);

// Register routes
app.register(router, { prefix: '/voice' });

// Error handling
app.setErrorHandler((error, request, reply) => {
  logger.error('Fastify error:', error);
  reply.status(500).send({ ok: false });
});

// Start server
const start = async () => {
  try {
    const PORT = config.server.port;
    await app.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server is running on port ${PORT}`);

    // Start Drip Campaign
    startDrip();

  } catch (err) {
    logger.error('Failed to start server:', err);
    process.exit(1);
  }
};

start();

// Graceful shutdown
const shutdown = async (signal) => {
  logger.info(`Received ${signal}. Shutting down gracefully...`);
  stopDrip();
  await app.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
