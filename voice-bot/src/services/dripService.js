import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { config } from '../config/config.js';
import fileLock from '../utils/fileLock.js';
import logger from '../utils/logger.js';
import twilio from 'twilio';
import path from 'path';

dayjs.extend(utc);
dayjs.extend(timezone);

const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
const CLIENTS_FILE = path.join(process.cwd(), 'src/data/clients.json');
const MOUNTAIN_TZ = 'America/Denver';

let dripInterval = null;
let isCallInProgress = false;
let isChecking = false;

export const startDrip = () => {
  if (dripInterval) {
    logger.warn('Drip service already running.');
    return;
  }

  logger.info('Starting Smart Drip Service...');
  // Check every minute
  dripInterval = setInterval(checkAndCall, 60 * 1000);
  checkAndCall(); // Run immediately
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Drip service stopped.');
  }
};

export const onCallEnded = () => {
  logger.info('Call ended. Releasing lock.');
  isCallInProgress = false;
  // Potentially trigger next call immediately? Or just wait for next interval.
  // Spec says: "Espera a que termine esa llamada por completo antes de buscar el siguiente."
  // So we just clear the flag. The interval will pick up the next one.
  // We can also trigger checkAndCall immediately to be more aggressive within the window.
  setTimeout(() => {
    logger.info('Triggering immediate check after call end...');
    checkAndCall();
  }, 5000); // Wait 5s before checking again
};

const checkAndCall = async () => {
  if (isChecking) {
    logger.info('Check already in progress. Skipping.');
    return;
  }
  isChecking = true;

  try {
    if (isCallInProgress) {
      logger.info('Call in progress. Skipping cycle.');
      return;
    }

    if (!isWithinOperatingHours()) {
      logger.info('Outside operating hours. No calls.');
      return;
    }

    await fileLock.update(CLIENTS_FILE, async (clients) => {
      // Re-check call progress inside lock just in case
      if (isCallInProgress) return clients;

      // 1. Find first PENDING
      const clientIndex = clients.findIndex(c => c.status === 'PENDING');

      if (clientIndex === -1) {
        logger.info('No PENDING clients found.');
        return clients; // No change
      }

      const client = clients[clientIndex];
      logger.info(`Found pending client: ${client.name} (${client.phone})`);

      // 2. Mark as CALLED
      clients[clientIndex].status = 'CALLED';
      clients[clientIndex].lastCalledAt = new Date().toISOString();

      // 3. Execute Call
      await initiateCall(client);

      return clients; // Save changes
    });
  } catch (error) {
    logger.error('Error in drip cycle:', error);
  } finally {
    isChecking = false;
  }
};

const initiateCall = async (client) => {
  try {
    isCallInProgress = true;
    const publicUrl = config.server.publicUrl;

    const call = await twilioClient.calls.create({
      to: client.phone,
      from: config.twilio.phoneNumber,
      url: `${publicUrl}/voice/outbound-twiml?clientId=${client.id}`,
      statusCallback: `${publicUrl}/voice/status-callback`,
      statusCallbackEvent: ['completed', 'busy', 'no-answer', 'failed', 'canceled'],
      method: 'POST'
    });

    logger.info(`Call initiated to ${client.phone}. SID: ${call.sid}`);
  } catch (error) {
    logger.error(`Failed to initiate call to ${client.phone}:`, error);
    isCallInProgress = false; // Release lock if call failed to start
    // We might want to mark client as FAILED or retry later, but spec says just mark CALLED.
  }
};

const isWithinOperatingHours = () => {
  const now = dayjs().tz(MOUNTAIN_TZ);
  const hour = now.hour();
  const minute = now.minute();

  // Morning: 9:30 - 11:30
  // 9:30 to 9:59 -> hour 9, min >= 30
  // 10:00 to 10:59 -> hour 10
  // 11:00 to 11:30 -> hour 11, min < 30 (strict < 30 as per memory "strictly uses < 30")

  const isMorning = (
    (hour === 9 && minute >= 30) ||
    (hour === 10) ||
    (hour === 11 && minute < 30)
  );

  // Afternoon: 2:30 PM - 3:30 PM (14:30 - 15:30)
  // 14:30 to 14:59 -> hour 14, min >= 30
  // 15:00 to 15:30 -> hour 15, min < 30

  const isAfternoon = (
    (hour === 14 && minute >= 30) ||
    (hour === 15 && minute < 30)
  );

  return isMorning || isAfternoon;
};
