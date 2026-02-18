import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';
import { withLock } from '../utils/fileLock.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLIENTS_FILE = path.join(__dirname, '../data/clients.json');

let isCallActive = false;
let dripInterval = null;
let nextCallTimeout = null;

const client = twilio(config.twilio.accountSid, config.twilio.authToken);

export const startDrip = () => {
  if (dripInterval) {
    logger.warn('Drip service already running.');
    return;
  }

  if (!config.server.publicUrl) {
    logger.error('Drip service cannot start: PUBLIC_URL is not set.');
    return;
  }

  logger.info('Starting Smart Drip service...');

  // Check every minute
  dripInterval = setInterval(checkAndCall, 60 * 1000);
  checkAndCall(); // Run immediately
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
  }
  if (nextCallTimeout) {
    clearTimeout(nextCallTimeout);
    nextCallTimeout = null;
  }
  logger.info('Drip service stopped.');
};

export const callEnded = () => {
  logger.info('Call ended, releasing concurrency lock.');
  isCallActive = false;
  // Potentially trigger next call check immediately
  // checkAndCall();
};

const checkAndCall = async () => {
  // Prevent concurrent checks
  await withLock('dripCheck', async () => {
    if (isCallActive) {
      logger.info('Call in progress, skipping check.');
      return;
    }

    if (!isWithinOperatingHours()) {
      logger.info('Outside operating hours.');
      return;
    }

    await makeNextCall();
  });
};

const isWithinOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const hour = now.hour();
  const minute = now.minute();

  // Morning: 9:30 - 11:30
  // 9:30 to 9:59 (hour 9, min >= 30)
  // 10:00 to 10:59 (hour 10)
  // 11:00 to 11:29 (hour 11, min < 30)
  const isMorning = (hour === 9 && minute >= 30) || (hour === 10) || (hour === 11 && minute < 30);

  // Afternoon: 14:30 - 15:30 (2:30 PM - 3:30 PM)
  // 14:30 to 14:59 (hour 14, min >= 30)
  // 15:00 to 15:29 (hour 15, min < 30)
  const isAfternoon = (hour === 14 && minute >= 30) || (hour === 15 && minute < 30);

  return isMorning || isAfternoon;
};

const makeNextCall = async () => {
  try {
    // Read and update clients.json with lock
    let targetClient = null;

    await withLock(CLIENTS_FILE, async () => {
        const data = await fs.readFile(CLIENTS_FILE, 'utf-8');
        const clients = JSON.parse(data);

        // Find first PENDING client
        const clientIndex = clients.findIndex(c => c.status === 'PENDING');

        if (clientIndex === -1) {
          logger.info('No pending clients found.');
          return;
        }

        targetClient = clients[clientIndex];

        // Update status to CALLED immediately to prevent double picking
        clients[clientIndex].status = 'CALLED';
        clients[clientIndex].lastCalled = new Date().toISOString();
        await fs.writeFile(CLIENTS_FILE, JSON.stringify(clients, null, 2));
    });

    if (!targetClient) return;

    logger.info(`Initiating call to ${targetClient.name} (${targetClient.phone})`);
    isCallActive = true;

    // Initiate call
    const call = await client.calls.create({
      to: targetClient.phone,
      from: config.twilio.phoneNumber,
      url: `${config.server.publicUrl}/voice/outbound-twiml?clientId=${targetClient.id}`,
      statusCallback: `${config.server.publicUrl}/voice/status-callback`,
      statusCallbackEvent: ['completed', 'busy', 'no-answer', 'failed']
    });

    logger.info(`Call initiated: ${call.sid}`);

  } catch (error) {
    logger.error('Error in makeNextCall:', error);
    isCallActive = false; // Release lock on error
  }
};
