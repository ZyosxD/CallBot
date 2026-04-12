import Fastify from 'fastify';
import fastifyFormbody from '@fastify/formbody';
import fastifyWebsocket from '@fastify/websocket';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
import { startDrip, stopDrip } from './services/dripService.js';

const app = Fastify({ logger: false });

// Register plugins
app.register(fastifyFormbody);
app.register(fastifyWebsocket);

// Register routes
app.register(router, { prefix: '/voice' });

// Error handling
app.setErrorHandler((error, request, reply) => {
  logger.error(error.stack);
  reply.status(500).send('Something broke!');
});

// Graceful shutdown
app.addHook('onClose', (instance, done) => {
  stopDrip();
  done();
});

// Start server
const PORT = config.server.port || 3000;
const start = async () => {
  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server is running on port ${PORT}`);

    // Initialize Twilio dialing engine (Smart Drip) upon server start
    startDrip();
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

start();
