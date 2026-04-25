import fastify from 'fastify';
import formbody from '@fastify/formbody';
import websocket from '@fastify/websocket';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
import { stopDrip } from './services/dripService.js';

const app = fastify({ logger: false });

// Register plugins
app.register(formbody);
app.register(websocket);

// Register routes
app.register(router, { prefix: '/voice' });

// Error handling
app.setErrorHandler((error, request, reply) => {
  logger.error(error.stack);
  reply.status(500).send('Something broke!');
});

// Graceful shutdown
const shutdown = async () => {
  logger.info('Shutting down server...');
  try {
    await app.close();
    logger.info('Server closed');
    process.exit(0);
  } catch (err) {
    logger.error('Error shutting down server:', err);
    process.exit(1);
  }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

app.addHook('onClose', (instance, done) => {
  stopDrip();
  done();
});

// Start server
const start = async () => {
  try {
    const PORT = config.server.port;
    await app.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server is running on port ${PORT}`);

    // Dynamic import to avoid circular dependency issues and only start after server is up
    const { startDrip } = await import('./services/dripService.js');
    startDrip();
  } catch (err) {
    logger.error('Error starting server:', err);
    process.exit(1);
  }
};

start();
