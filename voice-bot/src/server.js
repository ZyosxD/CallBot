import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { config } from './config/config.js';
import router from './controllers/router.js';
import { handleWebSocket } from './controllers/callController.js';
import logger from './utils/logger.js';
import { startDrip } from './services/dripService.js';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/voice/stream' });

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use('/voice', router);

wss.on('connection', (ws, req) => {
  handleWebSocket(ws, req);
});

app.use((err, req, res, next) => {
  logger.error(err.stack);
  res.status(500).send('Something broke!');
});

const PORT = config.server.port;
server.listen(PORT, () => {
  logger.info(`Server is running on port ${PORT}`);

  if (config.server.publicUrl) {
    logger.info('Starting Drip Service');
    startDrip();
  } else {
    logger.warn('PUBLIC_URL not set. Drip Service will not start.');
  }
});
