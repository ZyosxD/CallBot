import twilio from 'twilio';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { config } from '../config/config.js';
import * as leadService from './leadService.js';
import logger from '../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const client = twilio(config.twilio.accountSid, config.twilio.authToken);
const TIMEZONE = 'America/Denver'; // Mountain Time

let isCallInProgress = false;
let nextCallTimeout = null;

const isWithinOperatingHours = () => {
  const now = dayjs().tz(TIMEZONE);
  const hour = now.hour();
  const minute = now.minute();

  // Morning: 9:30 AM - 11:30 AM
  const isMorning = (hour === 9 && minute >= 30) || (hour === 10) || (hour === 11 && minute < 30);

  // Afternoon: 2:30 PM - 3:30 PM (14:30 - 15:30)
  const isAfternoon = (hour === 14 && minute >= 30) || (hour === 15 && minute < 30);

  return isMorning || isAfternoon;
};

export const makeNextCall = async () => {
  if (isCallInProgress) {
    logger.info('Call already in progress. Skipping makeNextCall.');
    return;
  }

  if (!isWithinOperatingHours()) {
    logger.info('Outside operating hours. Pausing drip.');
    return;
  }

  try {
    const nextClient = await leadService.getNextPendingClient();

    if (!nextClient) {
      logger.info('No pending clients found. Drip complete for now.');
      return;
    }

    // Lock immediately
    isCallInProgress = true;

    // Mark as CALLED to prevent duplicates
    await leadService.updateClientStatus(nextClient.id, 'CALLED');

    logger.info(`Initiating call to ${nextClient.name} (${nextClient.phone})`);

    // In a real scenario, we would use the public URL to callback
    // The TwiML should point to the WebSocket stream
    const call = await client.calls.create({
      url: `https://${config.server.publicUrl}/voice/outbound-twiml?clientId=${nextClient.id}`,
      to: nextClient.phone,
      from: config.twilio.phoneNumber,
      statusCallback: `https://${config.server.publicUrl}/voice/status`,
      statusCallbackEvent: ['completed', 'busy', 'no-answer', 'failed', 'canceled']
    });

    logger.info(`Call initiated: ${call.sid}`);

  } catch (error) {
    logger.error('Error in makeNextCall:', error);
    isCallInProgress = false;
    // Retry after a delay if error occurred?
    if (nextCallTimeout) clearTimeout(nextCallTimeout);
    nextCallTimeout = setTimeout(makeNextCall, 60000); // Retry in 1 minute
  }
};

export const handleCallEnded = async (callSid, status) => {
  logger.info(`Call ${callSid} ended with status: ${status}`);
  isCallInProgress = false;

  if (nextCallTimeout) clearTimeout(nextCallTimeout);

  // Wait 5 seconds before next call
  nextCallTimeout = setTimeout(() => {
    makeNextCall();
  }, 5000);
};

export const stopDrip = () => {
    if (nextCallTimeout) clearTimeout(nextCallTimeout);
    logger.info('Drip stopped manually.');
};
