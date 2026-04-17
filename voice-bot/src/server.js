import fastify from 'fastify';
import formbody from '@fastify/formbody';
import fastifyWebsocket from '@fastify/websocket';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
import { startDrip, stopDrip } from './services/dripService.js';

const app = fastify({ logger: false });

app.register(formbody);
app.register(fastifyWebsocket);

app.register(router, { prefix: '/voice' });

app.setErrorHandler((error, request, reply) => {
  logger.error(error.stack);
  reply.status(500).send('Something broke!');
});

const startServer = async () => {
  try {
    await app.listen({ port: config.server.port, host: '0.0.0.0' });
    logger.info(`Server is running on port ${config.server.port}`);
    startDrip();
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

const shutdown = () => {
  logger.info('Shutting down server...');
  stopDrip();
  app.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

startServer();
