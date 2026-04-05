import Fastify from 'fastify';
import formBody from '@fastify/formbody';
import fastifyWebsocket from '@fastify/websocket';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
import { startDrip, stopDrip } from './services/dripService.js';

const app = Fastify({ logger: false });

app.register(formBody);
app.register(fastifyWebsocket);

app.register(router, { prefix: '/voice' });

app.setErrorHandler((error, request, reply) => {
  logger.error(error.stack);
  reply.status(500).send({ error: 'Something went wrong' });
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
    startDrip();
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

start();
