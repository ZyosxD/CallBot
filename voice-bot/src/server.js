import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { config } from './config/config.js';
import router from './controllers/router.js';
import { handleWebSocket } from './controllers/callController.js';
import logger from './utils/logger.js';
import { startDrip, stopDrip } from './services/dripService.js';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/voice/stream' });

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Routes
app.use('/voice', router);

// WebSocket handling
wss.on('connection', (ws, req) => {
  handleWebSocket(ws, req);
});

// Error handling
app.use((err, req, res, next) => {
  logger.error(err.stack);
  res.status(500).send('Something broke!');
});

// Start server
const PORT = config.server.port;
server.listen(PORT, () => {
  logger.info(`Server is running on port ${PORT}`);

  // Start the Smart Drip Engine
  if (config.server.publicUrl) {
    startDrip();
  } else {
    logger.warn('Public URL not set. Drip Service requires PUBLIC_URL to be set.');
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Stopping...');
  stopDrip();
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});
