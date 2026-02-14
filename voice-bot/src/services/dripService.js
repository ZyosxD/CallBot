import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
// Dynamic import to avoid circular dependency
// import { makeOutboundCall } from '../controllers/callController.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const TIMEZONE = 'America/Denver';
const CLIENTS_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '../data/clients.json');

let isCallActive = false;
let dripInterval = null;

export const startDrip = () => {
  if (dripInterval) return;
  logger.info('Starting Smart Drip Service...');
  dripInterval = setInterval(checkAndCall, 60 * 1000); // Check every minute
  checkAndCall(); // Run immediately
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Stopped Smart Drip Service');
  }
};

export const callEnded = () => {
  logger.info('Call ended signal received. Releasing concurrency lock.');
  isCallActive = false;
};

const checkAndCall = async () => {
  if (isCallActive) {
    logger.info('Drip skipped: Call currently active.');
    return;
  }

  if (!isWithinOperatingHours()) {
    logger.info('Drip skipped: Outside operating hours.');
    return;
  }

  try {
    const clients = JSON.parse(await fs.readFile(CLIENTS_FILE, 'utf-8'));
    const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (nextClientIndex === -1) {
      logger.info('Drip skipped: No pending clients.');
      return;
    }

    const client = clients[nextClientIndex];
    logger.info(`Initiating call to ${client.name} (${client.phone})...`);

    // Mark as CALLED immediately
    clients[nextClientIndex].status = 'CALLED';
    clients[nextClientIndex].lastCalledAt = new Date().toISOString();
    await fs.writeFile(CLIENTS_FILE, JSON.stringify(clients, null, 2));

    // Initiate Call
    isCallActive = true;
    try {
        const { makeOutboundCall } = await import('../controllers/callController.js');
        await makeOutboundCall(client);
    } catch (error) {
        logger.error(`Failed to initiate call to ${client.phone}:`, error);
        isCallActive = false; // Release lock if call failed to start
        // Optionally revert status or mark as FAILED
        clients[nextClientIndex].status = 'FAILED';
        await fs.writeFile(CLIENTS_FILE, JSON.stringify(clients, null, 2));
    }

  } catch (error) {
    logger.error('Error in Drip Service:', error);
  }
};

const isWithinOperatingHours = () => {
  const now = dayjs().tz(TIMEZONE);
  const hour = now.hour();
  const minute = now.minute();

  // Morning: 9:30 - 11:30
  const isMorning = (hour === 9 && minute >= 30) || (hour === 10) || (hour === 11 && minute < 30);

  // Afternoon: 14:30 - 15:30 (2:30 PM - 3:30 PM)
  const isAfternoon = (hour === 14 && minute >= 30) || (hour === 15 && minute < 30);

  return isMorning || isAfternoon;
};
