import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';
import { withLock } from '../utils/fileLock.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLIENTS_FILE = path.join(__dirname, '../data/clients.json');

const TIMEZONE = 'America/Denver';

let isCallInProgress = false;
let dripInterval = null;

const client = twilio(config.twilio.accountSid, config.twilio.authToken);

export const startDripService = () => {
  if (dripInterval) return;

  logger.info('Starting Smart Drip Service...');
  // Check every minute
  dripInterval = setInterval(checkAndCall, 60 * 1000);
  checkAndCall(); // Initial check
};

export const stopDripService = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Smart Drip Service stopped.');
  }
};

export const callEnded = () => {
  isCallInProgress = false;
  logger.info('Call ended. Ready for next call.');
  // Optionally trigger next call immediately after a short delay
  setTimeout(checkAndCall, 5000);
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

const checkAndCall = async () => {
  if (isCallInProgress) {
    logger.debug('Call in progress, skipping drip cycle.');
    return;
  }

  if (!isWithinOperatingHours()) {
    logger.debug('Outside operating hours, skipping drip cycle.');
    return;
  }

  try {
    let clientToCall = null;

    await withLock(CLIENTS_FILE, async () => {
      const data = await fs.readFile(CLIENTS_FILE, 'utf-8');
      const clients = JSON.parse(data);

      const pendingClientIndex = clients.findIndex(c => c.status === 'PENDING');

      if (pendingClientIndex !== -1) {
        clientToCall = clients[pendingClientIndex];
        // Mark as CALLED immediately to prevent duplicates
        clients[pendingClientIndex].status = 'CALLED';
        clients[pendingClientIndex].calledAt = new Date().toISOString();
        await fs.writeFile(CLIENTS_FILE, JSON.stringify(clients, null, 2));
      }
    });

    if (clientToCall) {
      logger.info(`Initiating call to ${clientToCall.name} (${clientToCall.phone})`);
      isCallInProgress = true;

      try {
        await client.calls.create({
          url: `${config.server.publicUrl}/voice/outbound-twiml?clientId=${clientToCall.id}`,
          to: clientToCall.phone,
          from: config.twilio.phoneNumber,
          statusCallback: `${config.server.publicUrl}/voice/status-callback`,
          statusCallbackEvent: ['completed', 'busy', 'no-answer', 'failed', 'canceled']
        });
      } catch (error) {
        logger.error('Error initiating Twilio call:', error);
        isCallInProgress = false; // Reset if call failed to start
      }
    } else {
      logger.debug('No pending clients found.');
    }

  } catch (error) {
    logger.error('Error in drip cycle:', error);
  }
};
