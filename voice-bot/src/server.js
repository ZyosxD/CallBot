import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { config } from './config/config.js';
import router from './controllers/router.js';
import { handleWebSocket } from './controllers/callController.js';
import { startDripService } from './services/dripService.js';
import logger from './utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);

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

  if (config.server.publicUrl) {
    startDripService();
  } else {
    logger.warn('PUBLIC_URL is missing. Outbound drip service will not start.');
  }
});
