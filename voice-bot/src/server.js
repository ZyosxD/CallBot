import fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyFormbody from '@fastify/formbody';
import { config } from './config/config.js';
import router from './controllers/router.js';
import { handleWebSocket } from './controllers/callController.js';
import logger from './utils/logger.js';
import { startDrip } from './services/dripService.js';

const app = fastify();

// Check PUBLIC_URL
if (!config.server.publicUrl) {
  logger.warn('PUBLIC_URL is not set. Drip Service will not start.');
}

app.register(fastifyFormbody);
app.register(fastifyWebsocket);

app.register(async function (fastifyInstance) {
  fastifyInstance.get('/voice/stream', { websocket: true }, (connection, req) => {
    handleWebSocket(connection, req);
  });
});

app.register(router, { prefix: '/voice' });

app.setErrorHandler((error, request, reply) => {
  logger.error(error.stack);
  reply.status(500).send('Something broke!');
});

const PORT = config.server.port;
app.listen({ port: PORT, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    logger.error(err);
    process.exit(1);
  }
  logger.info(`Server is running on ${address}`);
  if (config.server.publicUrl) {
    startDrip();
  }
});
