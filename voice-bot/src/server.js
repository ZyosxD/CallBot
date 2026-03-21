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

// Error handling
app.setErrorHandler((error, request, reply) => {
  logger.error(error);
  reply.status(500).send({ error: 'Internal Server Error' });
});

app.addHook('onClose', (instance, done) => {
  stopDrip();
  done();
});

const start = async () => {
  try {
    const PORT = config.server.port;
    await app.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server is running on port ${PORT}`);

    // Start the drip service after server starts
    startDrip();
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

start();
