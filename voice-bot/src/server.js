import fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyFormbody from '@fastify/formbody';
import { config } from './config/config.js';
import router from './controllers/router.js';
import { handleWebSocket } from './controllers/callController.js';
import { startDrip, stopDrip } from './services/dripService.js';
import logger from './utils/logger.js';

const app = fastify({ logger: false });

// Register plugins
app.register(fastifyFormbody);
app.register(fastifyWebsocket);

// Register routes
app.register(router, { prefix: '/voice' });

// WebSocket route (must be relative to prefix if it were inside the router,
// but since we want the exact path matching old behavior, we define it here on the root app)
app.register(async function (fastifyInstance) {
  fastifyInstance.get('/voice/stream', { websocket: true }, (connection, req) => {
    handleWebSocket(connection, req);
  });
});

// Error handling
app.setErrorHandler((error, request, reply) => {
  logger.error(error.stack);
  reply.status(500).send('Something broke!');
});

// Graceful shutdown
app.addHook('onClose', (instance, done) => {
  stopDrip();
  done();
});

// Start server
const start = async () => {
  try {
    const PORT = config.server.port;
    await app.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server is running on port ${PORT}`);

    // Start the drip service
    startDrip();
  } catch (err) {
    logger.error('Error starting server:', err);
    process.exit(1);
  }
};

start();
