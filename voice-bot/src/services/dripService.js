import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import twilio from 'twilio';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLIENTS_FILE = path.join(__dirname, '../data/clients.json');

let isCallInProgress = false;
let dripInterval = null;

const client = twilio(config.twilio.accountSid, config.twilio.authToken);

export const startDrip = () => {
  if (dripInterval) {
    logger.warn('Drip service already running');
    return;
  }
  logger.info('Starting Smart Drip Service');
  dripInterval = setInterval(makeNextCall, 60000); // Check every minute
  makeNextCall(); // Run immediately
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Stopped Smart Drip Service');
  }
};

export const notifyCallEnded = () => {
  logger.info('Call ended notification received. Releasing lock.');
  isCallInProgress = false;
};

const isWithinOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const hour = now.hour();
  const minute = now.minute();

  // Morning: 9:30 - 11:30
  const isMorning = (hour === 9 && minute >= 30) || (hour === 10) || (hour === 11 && minute < 30);

  // Afternoon: 14:30 - 15:30
  const isAfternoon = (hour === 14 && minute >= 30) || (hour === 15 && minute < 30);

  return isMorning || isAfternoon;
};

const makeNextCall = async () => {
  if (isCallInProgress) {
    logger.info('Call in progress, skipping cycle');
    return;
  }

  // Uncomment to enforce operating hours
  // if (!isWithinOperatingHours()) {
  //   logger.info('Outside operating hours, skipping cycle');
  //   return;
  // }

  // For development/testing purposes, I'll log if outside hours but proceed if needed,
  // or strictly follow spec. The spec says "Smart Drip".
  // Given I can't easily change time, I should probably respect it but maybe log.
  // Actually, I will respect the spec.
  if (!isWithinOperatingHours()) {
     logger.info('Outside operating hours (Mountain Time), skipping cycle');
     return;
  }

  try {
    if (!fs.existsSync(CLIENTS_FILE)) {
      logger.error('Clients file not found');
      return;
    }

    const clientsData = fs.readFileSync(CLIENTS_FILE, 'utf8');
    const clients = JSON.parse(clientsData);

    const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (nextClientIndex === -1) {
      logger.info('No pending clients found');
      return;
    }

    const nextClient = clients[nextClientIndex];

    // Mark as CALLED
    clients[nextClientIndex].status = 'CALLED';
    fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));

    isCallInProgress = true;
    logger.info(`Initiating call to ${nextClient.name} (${nextClient.phone})`);

    // Initiate call
    // Note: publicUrl must be set.
    if (!config.server.publicUrl) {
        logger.error('Public URL not set, cannot initiate call');
        isCallInProgress = false;
        return;
    }

    await client.calls.create({
      url: `${config.server.publicUrl}/voice/outbound-twiml?clientId=${nextClient.id}&callerId=${encodeURIComponent(nextClient.phone)}`,
      to: nextClient.phone,
      from: config.twilio.phoneNumber,
      statusCallback: `${config.server.publicUrl}/voice/status-callback`,
      statusCallbackEvent: ['completed', 'busy', 'no-answer', 'failed', 'canceled']
    });

  } catch (error) {
    logger.error('Error in makeNextCall:', error);
    isCallInProgress = false; // Release lock on error
  }
};
