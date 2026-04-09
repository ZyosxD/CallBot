import fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyFormbody from '@fastify/formbody';
import { config } from './config/config.js';
import router from './controllers/router.js';
import logger from './utils/logger.js';
// The import for startDrip will be added later when we create dripService.js.
// We'll use a dynamic import to avoid initial resolution errors.

const app = fastify({ logger: false }); // Use our winston logger instead

// Register plugins
app.register(fastifyFormbody);
app.register(fastifyWebsocket, {
  options: { maxPayload: 1048576 }
});

// Register routes
app.register(router, { prefix: '/voice' });

// Global error handler
app.setErrorHandler((error, request, reply) => {
  logger.error('Fastify Error:', error);
  reply.status(500).send({ error: 'Internal Server Error' });
});

app.addHook('onClose', async (instance, done) => {
    try {
        const { stopDrip } = await import('./services/dripService.js');
        stopDrip();
    } catch (e) {
        // ignore
    }
    done();
});

const start = async () => {
  try {
    const PORT = config.server.port || 3000;
    await app.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Fastify server running on port ${PORT}`);

    // Start drip
    try {
        const { startDrip } = await import('./services/dripService.js');
        startDrip();
    } catch (e) {
        // ignore for now
    }

  } catch (err) {
    logger.error('Failed to start server:', err);
    process.exit(1);
  }
};

start();
