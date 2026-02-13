import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import twilio from 'twilio';
import { config } from '../config/config.js';
import { getNextPendingClient, updateClientStatus } from './leadService.js';
import logger from '../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const TIMEZONE = 'America/Denver';

let isCallActive = false;
let checkInterval = null;

const client = twilio(config.twilio.accountSid, config.twilio.authToken);

const isWithinOperatingHours = () => {
  const now = dayjs().tz(TIMEZONE);
  const hour = now.hour();
  const minute = now.minute();

  // Morning: 09:30 - 11:30
  if (hour === 9 && minute >= 30) return true;
  if (hour === 10) return true;
  if (hour === 11 && minute < 30) return true;

  // Afternoon: 14:30 - 15:30
  if (hour === 14 && minute >= 30) return true;
  if (hour === 15 && minute < 30) return true;

  return false;
};

const makeNextCall = async () => {
  if (isCallActive) {
    logger.info('Call currently active, skipping next call.');
    return;
  }

  if (!isWithinOperatingHours()) {
    logger.info('Outside operating hours, skipping next call.');
    return;
  }

  const nextClient = await getNextPendingClient();
  if (!nextClient) {
    logger.info('No pending clients found.');
    return;
  }

  try {
    isCallActive = true;
    // Mark as CALLED immediately
    await updateClientStatus(nextClient.id, 'CALLED');
    logger.info(`Initiating call to ${nextClient.name} (${nextClient.phone})`);

    const call = await client.calls.create({
      to: nextClient.phone,
      from: config.twilio.phoneNumber,
      url: `${config.server.publicUrl}/voice/outbound-twiml?clientId=${nextClient.id}`,
      statusCallback: `${config.server.publicUrl}/voice/status`,
      statusCallbackEvent: ['completed', 'busy', 'no-answer', 'failed', 'canceled']
    });

    logger.info(`Call initiated. SID: ${call.sid}`);

  } catch (error) {
    logger.error('Error initiating call:', error);
    isCallActive = false; // Reset if failed
  }
};

export const startDrip = () => {
  if (checkInterval) return;

  logger.info('Starting Smart Drip Service...');

  // Initial check
  makeNextCall();

  // Check every minute if we should make a call (in case the previous one finished or time window opened)
  // Note: logic prevents double calling if isCallActive is true
  checkInterval = setInterval(() => {
    makeNextCall();
  }, 60 * 1000);
};

export const stopDrip = () => {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
    logger.info('Stopped Smart Drip Service.');
  }
};

export const handleCallEnded = () => {
  logger.info('Call ended event received.');
  isCallActive = false;
  // Trigger next call logic after a short delay (e.g., 5 seconds) to allow cleanup
  setTimeout(() => {
    makeNextCall();
  }, 5000);
};
