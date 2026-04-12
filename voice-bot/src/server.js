import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyFormbody from '@fastify/formbody';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
import { stopDrip, startDrip } from './services/dripService.js';

const app = Fastify({ logger: false });

app.register(fastifyFormbody);
app.register(fastifyWebsocket);

app.register(router, { prefix: '/voice' });

app.addHook('onClose', async (instance, done) => {
  logger.info('Shutting down server, stopping drip...');
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
