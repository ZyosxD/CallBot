import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import websocket from '@fastify/websocket';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
import { startDrip, stopDrip } from './services/dripService.js';

const fastify = Fastify({ logger: false });

async function build() {
  await fastify.register(formbody);
  await fastify.register(websocket);
  await fastify.register(router, { prefix: '/voice' });

  fastify.setErrorHandler((error, request, reply) => {
    logger.error(error.stack);
    reply.status(500).send('Something broke!');
  });

  fastify.addHook('onClose', (instance, done) => {
    stopDrip();
    done();
  });
}

build().then(() => {
  const PORT = config.server.port;
  fastify.listen({ port: PORT, host: '0.0.0.0' }, (err, address) => {
    if (err) {
      logger.error(err);
      process.exit(1);
    }
    logger.info(`Server is running on ${address}`);
    startDrip();
  });
});
