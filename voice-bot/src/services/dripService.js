import twilio from 'twilio';
import { config } from '../config/config.js';
import { getNextPendingClient, updateClientStatus } from './leadService.js';
import logger from '../utils/logger.js';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const client = twilio(config.twilio.accountSid, config.twilio.authToken);
let isDripActive = false;
let callInProgress = false;
let nextCallTimeout = null;

// Constants
const TIMEZONE = 'America/Denver';

export const startDrip = async () => {
  if (isDripActive) {
    logger.info('Drip service already active.');
    return;
  }

  logger.info('Starting Smart Drip service...');
  isDripActive = true;
  await makeNextCall();
};

export const stopDrip = () => {
  logger.info('Stopping Smart Drip service...');
  isDripActive = false;
  if (nextCallTimeout) {
    clearTimeout(nextCallTimeout);
    nextCallTimeout = null;
  }
};

export const makeNextCall = async () => {
  if (!isDripActive) {
    logger.info('Drip is not active. Skipping next call.');
    return;
  }

  if (callInProgress) {
    logger.info('Call already in progress. Waiting for completion.');
    return;
  }

  // Double check operating hours just in case
  if (!checkOperatingHours()) {
    logger.info('Outside operating hours. Stopping drip.');
    stopDrip();
    return;
  }

  try {
    const prospect = await getNextPendingClient();

    if (!prospect) {
      logger.info('No more pending clients. Stopping drip.');
      stopDrip();
      return;
    }

    logger.info(`Initiating call to ${prospect.name} (${prospect.company}) at ${prospect.phone}`);

    // Mark as CALLED immediately to prevent duplicates
    await updateClientStatus(prospect.id, 'CALLED');

    callInProgress = true;

    const call = await client.calls.create({
      to: prospect.phone,
      from: config.twilio.phoneNumber,
      url: `${config.server.publicUrl}/voice/outbound-twiml?clientId=${prospect.id}&direction=outbound`,
      statusCallback: `${config.server.publicUrl}/voice/status`,
      statusCallbackEvent: ['completed', 'busy', 'no-answer', 'failed', 'canceled']
    });

    logger.info(`Call initiated: ${call.sid}`);

  } catch (error) {
    logger.error('Error in makeNextCall:', error);
    callInProgress = false;
    // Retry after a delay if it was an error
    nextCallTimeout = setTimeout(makeNextCall, 10000);
  }
};

export const onCallEnded = () => {
  logger.info('Call ended signal received.');
  callInProgress = false;

  // Clear any existing timeout to prevent multiple schedules
  if (nextCallTimeout) {
    clearTimeout(nextCallTimeout);
  }

  // Wait a random short delay or fixed delay before next call to be natural
  if (isDripActive) {
    logger.info('Scheduling next call in 5 seconds...');
    nextCallTimeout = setTimeout(makeNextCall, 5000);
  }
};

const checkOperatingHours = () => {
  const now = dayjs().tz(TIMEZONE);
  const hour = now.hour();
  const minute = now.minute();
  const time = hour + minute / 60;

  // Morning: 9:30 - 11:30 (9.5 - 11.5)
  const isMorning = time >= 9.5 && time < 11.5;

  // Afternoon: 2:30 PM - 3:30 PM (14.5 - 15.5)
  const isAfternoon = time >= 14.5 && time < 15.5;

  // Also check if it's a weekday (Monday=1 to Friday=5)
  const isWeekday = now.day() >= 1 && now.day() <= 5;

  return (isMorning || isAfternoon) && isWeekday;
};
