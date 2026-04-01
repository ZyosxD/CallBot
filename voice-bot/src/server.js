import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import websocket from '@fastify/websocket';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
import { stopDrip, startDrip } from './services/dripService.js';

const app = Fastify({ logger: false });

app.register(formbody);
app.register(websocket);

app.register(router, { prefix: '/voice' });

app.addHook('onClose', (instance, done) => {
  stopDrip();
  done();
});

app.setErrorHandler((error, request, reply) => {
  logger.error(error.stack);
  reply.status(500).send('Something broke!');
});

const startServer = async () => {
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

startServer();
