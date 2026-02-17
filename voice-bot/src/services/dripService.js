import fs from 'fs/promises';
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENTS_FILE = path.join(__dirname, '../data/clients.json');
const TIMEZONE = 'America/Denver';

let isCallActive = false;
let dripInterval = null;

const client = twilio(config.twilio.accountSid, config.twilio.authToken);

export const startDrip = () => {
  if (dripInterval) return;

  logger.info('Starting Smart Drip Service...');
  // Check every 1 minute
  dripInterval = setInterval(checkAndMakeCall, 60 * 1000);
  // Also run immediately with a slight delay to allow server to startup
  setTimeout(checkAndMakeCall, 5000);
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Stopped Smart Drip Service.');
  }
};

export const callEnded = () => {
  logger.info('Call ended. Releasing concurrency lock.');
  isCallActive = false;
};

const checkAndMakeCall = async () => {
  try {
    if (isCallActive) {
      logger.info('Drip: Call currently active. Skipping.');
      return;
    }

    if (!isWithinOperatingHours()) {
      logger.info('Drip: Outside operating hours. Skipping.');
      return;
    }

    if (!config.server.publicUrl) {
         logger.warn('Drip: PUBLIC_URL not set. Cannot initiate calls.');
         return;
    }

    const clientsData = await fs.readFile(CLIENTS_FILE, 'utf-8');
    const clients = JSON.parse(clientsData);
    const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (nextClientIndex === -1) {
      logger.info('Drip: No PENDING clients found.');
      return;
    }

    const nextClient = clients[nextClientIndex];

    // Mark as CALLED immediately
    clients[nextClientIndex].status = 'CALLED';
    await fs.writeFile(CLIENTS_FILE, JSON.stringify(clients, null, 2));

    logger.info(`Drip: Initiating call to ${nextClient.name} (${nextClient.phone})`);

    isCallActive = true;

    // Construct the TwiML URL.
    const callbackUrl = `${config.server.publicUrl}/voice/outbound-twiml?callerId=${nextClient.phone}&clientId=${nextClient.id}&clientName=${encodeURIComponent(nextClient.name)}&company=${encodeURIComponent(nextClient.company)}`;

    await client.calls.create({
      url: callbackUrl,
      to: nextClient.phone,
      from: config.twilio.phoneNumber,
      // We can also add statusCallback to handle non-connected calls (busy, failed)
      // For now, we rely on concurrency lock and assume if it fails, the callEnded won't be called from WS
      // So we SHOULD handle statusCallback to release lock if call fails to connect.
      statusCallback: `${config.server.publicUrl}/voice/status`,
      statusCallbackEvent: ['completed', 'busy', 'no-answer', 'failed', 'canceled']
    });

  } catch (error) {
    logger.error('Drip: Error in checkAndMakeCall:', error);
    isCallActive = false; // Release lock on error
  }
};

const isWithinOperatingHours = () => {
  const now = dayjs().tz(TIMEZONE);
  const hour = now.hour();
  const minute = now.minute();

  // Morning: 9:30 - 11:30
  // 9:30 inclusive to 11:30 exclusive (calls shouldn't start AT 11:30)
  const isMorning = (hour === 9 && minute >= 30) || (hour === 10) || (hour === 11 && minute < 30);

  // Afternoon: 14:30 - 15:30 (2:30 PM - 3:30 PM)
  const isAfternoon = (hour === 14 && minute >= 30) || (hour === 15 && minute < 30);

  return isMorning || isAfternoon;
};
