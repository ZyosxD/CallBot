import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import logger from '../utils/logger.js';
import { outboundCall } from '../controllers/callController.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENTS_FILE = path.join(__dirname, '../data/clients.json');

let isCallActive = false;
let dripInterval = null;

// Operating Hours Logic
const isWithinOperatingHours = () => {
    const now = dayjs().tz('America/Denver');
    const hour = now.hour();
    const minute = now.minute();

    // Morning: 9:30 - 11:30
    // 9:30 to 11:29
    // hour === 9 && minute >= 30: 9:30-9:59
    // hour === 10: 10:00-10:59
    // hour === 11 && minute < 30: 11:00-11:29
    const isMorning = (hour === 9 && minute >= 30) || (hour === 10) || (hour === 11 && minute < 30);

    // Afternoon: 14:30 - 15:30 (2:30 PM - 3:30 PM)
    // 14:30 to 15:29
    // hour === 14 && minute >= 30: 14:30-14:59
    // hour === 15 && minute < 30: 15:00-15:29
    const isAfternoon = (hour === 14 && minute >= 30) || (hour === 15 && minute < 30);

    return isMorning || isAfternoon;
};

// Main Drip Logic
const processDripLoop = async () => {
  if (isCallActive) {
    logger.debug('Drip skipped: Call currently active.');
    return;
  }

  if (!isWithinOperatingHours()) {
    // Only log periodically to avoid spamming logs, or use debug
    // logger.debug('Drip skipped: Outside operating hours (Mountain Time).');
    return;
  }

  try {
    const data = await fs.readFile(CLIENTS_FILE, 'utf-8');
    const clients = JSON.parse(data);
    const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (nextClientIndex === -1) {
      // logger.info('Drip paused: No pending clients found.');
      return;
    }

    const client = clients[nextClientIndex];

    // Mark as CALLED immediately
    clients[nextClientIndex].status = 'CALLED';
    clients[nextClientIndex].lastCalled = new Date().toISOString();

    await fs.writeFile(CLIENTS_FILE, JSON.stringify(clients, null, 2));

    logger.info(`Initiating call to ${client.name} (${client.phone})...`);
    isCallActive = true;

    try {
        await outboundCall(client.phone);
    } catch (error) {
        logger.error(`Failed to initiate call to ${client.phone}:`, error);
        isCallActive = false; // Release lock if call failed to start

        // Re-read file to avoid race conditions (simple approach)
        // Or just update the in-memory array assuming no other process modifies it
        clients[nextClientIndex].status = 'FAILED';
        clients[nextClientIndex].notes = (clients[nextClientIndex].notes || '') + ` | Failed: ${error.message}`;
        await fs.writeFile(CLIENTS_FILE, JSON.stringify(clients, null, 2));
    }

  } catch (error) {
    logger.error('Error in Drip Loop:', error);
    isCallActive = false;
  }
};

export const startDrip = () => {
  logger.info('Starting Smart Drip Service...');
  // Run immediately then every minute
  processDripLoop();
  dripInterval = setInterval(processDripLoop, 60 * 1000);
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Smart Drip Service stopped.');
  }
};

export const handleCallEnded = (callSid) => {
    logger.info(`Call ended signal received for ${callSid}. Releasing lock.`);
    isCallActive = false;
    // Optionally create a short delay before next call
    setTimeout(() => {
        logger.info('Ready for next call.');
    }, 5000);
};
