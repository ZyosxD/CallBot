import fastify from 'fastify';
import formbody from '@fastify/formbody';
import websocketPlugin from '@fastify/websocket';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
import { startDrip, stopDrip } from './services/dripService.js';

const app = fastify({ logger: false });

// Register plugins
app.register(formbody);
app.register(websocketPlugin);

// Register routes mapping to /voice prefix
app.register(router, { prefix: '/voice' });

// Setup Graceful Shutdown
const closeGracefully = async (signal) => {
  logger.info(`Received signal to terminate: ${signal}`);
  await app.close();
  process.exit(0);
};

process.on('SIGINT', closeGracefully);
process.on('SIGTERM', closeGracefully);

app.addHook('onClose', async (instance, done) => {
  logger.info('Server is closing...');
  stopDrip();
  done();
});

// Start server
const start = async () => {
  try {
    const PORT = config.server.port;
    await app.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server is running on port ${PORT}`);

    // Start Smart Drip Engine
    startDrip();

  } catch (err) {
    logger.error('Error starting server:', err);
    process.exit(1);
  }
};

start();
