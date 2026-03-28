import fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyFormbody from '@fastify/formbody';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
import { startDrip, stopDrip } from './services/dripService.js';

const app = fastify({ logger: false });

app.register(fastifyFormbody);
app.register(fastifyWebsocket);

app.register(router, { prefix: '/voice' });

app.setErrorHandler((error, request, reply) => {
  logger.error(error.stack);
  reply.status(500).send('Something broke!');
});

app.addHook('onClose', (instance, done) => {
  stopDrip();
  done();
});

const start = async () => {
  try {
    await app.listen({ port: config.server.port, host: '0.0.0.0' });
    logger.info(`Server is running on port ${config.server.port}`);
    startDrip();
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

start();
