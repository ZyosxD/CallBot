import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { config } from './config/config.js';
import router from './controllers/router.js';
import { handleWebSocket } from './controllers/callController.js';
import logger from './utils/logger.js';
import { startDripService } from './services/dripService.js';

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

  // Startup check for Drip Service
  if (config.server.publicUrl) {
    logger.info(`Public URL configured: ${config.server.publicUrl}`);
    startDripService();
  } else {
    logger.warn('WARNING: Public URL not set. Drip Service will NOT start.');
    logger.warn('Please configure PUBLIC_URL in .env for outbound calls.');
  }
});
