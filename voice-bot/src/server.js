import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import fastifyWebsocket from '@fastify/websocket';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
import { startDrip, stopDrip } from './services/dripService.js';

const app = Fastify({ logger: false });

app.register(formbody);
app.register(fastifyWebsocket);

app.register(router, { prefix: '/voice' });

app.addHook('onClose', (instance, done) => {
  logger.info('Shutting down server...');
  stopDrip();
  done();
});

const start = async () => {
  try {
    await app.listen({ port: config.server.port, host: '0.0.0.0' });
    logger.info(`Server listening on port ${config.server.port}`);
    startDrip();
  } catch (err) {
    logger.error('Error starting server:', err);
    process.exit(1);
  }
};

start();