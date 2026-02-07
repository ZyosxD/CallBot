import fs from 'fs';
import path from 'path';
import logger from '../utils/logger.js';

const CLIENTS_FILE = path.resolve('clients.json');

export const getNextClient = async () => {
  try {
    if (!fs.existsSync(CLIENTS_FILE)) {
      logger.warn('Clients file not found, creating empty one.');
      fs.writeFileSync(CLIENTS_FILE, '[]');
      return null;
    }

    const data = fs.readFileSync(CLIENTS_FILE, 'utf8');
    const clients = JSON.parse(data);

    // Find first PENDING
    const client = clients.find(c => c.status === 'PENDING');

    if (client) {
      // Mark as CALLED immediately to avoid duplicates in rapid succession
      client.status = 'CALLED';
      client.lastCalled = new Date().toISOString();
      fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));
      logger.info(`Next client selected for drip: ${client.name}`);
      return client;
    }

    return null;
  } catch (error) {
    logger.error('Error in getNextClient:', error);
    return null;
  }
};

export const markClientStatus = async (phone, status) => {
    try {
        if (!fs.existsSync(CLIENTS_FILE)) return;

        const data = fs.readFileSync(CLIENTS_FILE, 'utf8');
        const clients = JSON.parse(data);
        const client = clients.find(c => c.phone === phone);

        if (client) {
            client.status = status;
            fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));
            logger.info(`Updated client ${phone} status to ${status}`);
        }
    } catch (error) {
        logger.error('Error in markClientStatus:', error);
    }
};
