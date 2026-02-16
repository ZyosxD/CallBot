import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLIENTS_FILE = path.join(__dirname, '../data/clients.json');

const client = twilio(config.twilio.accountSid, config.twilio.authToken);

let isCallActive = false;
let dripInterval = null;

const MOUNTAIN_TZ = 'America/Denver';

const isWithinOperatingHours = () => {
  const now = dayjs().tz(MOUNTAIN_TZ);
  const hour = now.hour();
  const minute = now.minute();

  // Morning: 9:30 - 11:30
  // 9:30 to 9:59 OR 10:00 to 10:59 OR 11:00 to 11:29
  const isMorning = (hour === 9 && minute >= 30) || (hour === 10) || (hour === 11 && minute < 30);

  // Afternoon: 14:30 - 15:30 (2:30 PM - 3:30 PM)
  // 14:30 to 14:59 OR 15:00 to 15:29
  const isAfternoon = (hour === 14 && minute >= 30) || (hour === 15 && minute < 30);

  return isMorning || isAfternoon;
};

export const startDrip = () => {
  if (dripInterval) return;

  if (!config.server.publicUrl) {
    logger.warn('PUBLIC_URL is not set. Drip service will fail to make calls.');
  }

  logger.info('Starting Smart Drip Service...');
  dripInterval = setInterval(async () => {
    if (isCallActive) {
      return;
    }

    if (!isWithinOperatingHours()) {
        // Optional: log debug "Outside operating hours"
      return;
    }

    await makeNextCall();

  }, 60000); // Check every minute
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Stopped Smart Drip Service.');
  }
};

const makeNextCall = async () => {
  try {
    if (!fs.existsSync(CLIENTS_FILE)) {
        logger.error('Clients file not found.');
        return;
    }

    const data = fs.readFileSync(CLIENTS_FILE, 'utf8');
    const clients = JSON.parse(data);

    const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (nextClientIndex === -1) {
      // logger.info('No pending clients found.');
      return;
    }

    const nextClient = clients[nextClientIndex];
    logger.info(`Initiating call for client: ${nextClient.name} (${nextClient.phone})`);

    // Update status to prevent duplicate calls
    clients[nextClientIndex].status = 'CALLED';
    fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));

    isCallActive = true;

    // Initiate Call
    // Note: statusCallback is crucial to release the lock if the call fails or is busy.
    await client.calls.create({
      url: `${config.server.publicUrl}/voice/outbound-twiml?clientId=${nextClient.id}`,
      to: nextClient.phone,
      from: config.twilio.phoneNumber,
      statusCallback: `${config.server.publicUrl}/voice/status-callback`,
      statusCallbackEvent: ['completed', 'busy', 'no-answer', 'failed', 'canceled']
    });

  } catch (error) {
    logger.error('Error in makeNextCall:', error);
    isCallActive = false; // Reset if error occurs
  }
};

export const callEnded = () => {
  if (isCallActive) {
    logger.info('Call ended signal received. Releasing lock.');
    isCallActive = false;
  }
};
