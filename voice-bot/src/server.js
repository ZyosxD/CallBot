import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import fastifyWebsocket from '@fastify/websocket';
import { config } from './config/config.js';
import routerPlugin from './controllers/router.js';
import logger from './utils/logger.js';
import { stopDrip, startDrip } from './services/dripService.js';

const fastify = Fastify({ logger: false });

async function buildServer() {
  await fastify.register(formbody);
  await fastify.register(fastifyWebsocket);
  await fastify.register(routerPlugin, { prefix: '/voice' });

  // Graceful shutdown
  const closeServer = async () => {
    logger.info('Shutting down server...');
    await stopDrip();
    await fastify.close();
    process.exit(0);
  };

  process.on('SIGINT', closeServer);
  process.on('SIGTERM', closeServer);

  return fastify;
}

buildServer()
  .then(async (app) => {
    const PORT = config.server.port;
    await app.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server is running on port ${PORT}`);
    startDrip();
  })
  .catch((err) => {
    logger.error('Error starting server', err);
    process.exit(1);
  });
