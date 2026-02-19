import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import twilio from 'twilio';
import { config } from '../config/config.js';
import { readJson, writeJson } from '../utils/fileLock.js';
import logger from '../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const TIMEZONE = 'America/Denver';
const MORNING_START = 9.5; // 9:30
const MORNING_END = 11.5; // 11:30
const AFTERNOON_START = 14.5; // 14:30
const AFTERNOON_END = 15.5; // 15:30

let isCallInProgress = false;
let dripInterval = null;

// Ensure publicUrl is set before creating calls
if (!config.server.publicUrl) {
    logger.warn('WARNING: config.server.publicUrl is not set. Drip Service will not be able to initiate calls.');
}

const client = twilio(config.twilio.accountSid, config.twilio.authToken);

export const startDrip = () => {
  if (dripInterval) return;
  logger.info('Starting Drip Service...');
  dripInterval = setInterval(runDripLoop, 60000); // Check every minute
  runDripLoop(); // Run immediately
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Stopped Drip Service.');
  }
};

export const callEnded = () => {
  logger.info('Call released lock in Drip Service.');
  isCallInProgress = false;
};

const isWithinOperatingHours = () => {
  const now = dayjs().tz(TIMEZONE);
  const hour = now.hour();
  const minute = now.minute();
  const time = hour + minute / 60;

  // Morning: 9:30 - 11:30
  if (time >= MORNING_START && time < MORNING_END) return true;
  // Afternoon: 14:30 - 15:30
  if (time >= AFTERNOON_START && time < AFTERNOON_END) return true;

  return false;
};

const runDripLoop = async () => {
  if (isCallInProgress) {
    logger.info('Drip Service: Call in progress, waiting...');
    return;
  }

  if (!isWithinOperatingHours()) {
    // Only log occasionally to avoid spamming
    // logger.info('Drip Service: Outside operating hours.');
    return;
  }

  if (!config.server.publicUrl) {
      return;
  }

  try {
    const clients = await readJson('clients.json');
    const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (nextClientIndex === -1) {
      logger.info('Drip Service: No pending clients found.');
      stopDrip(); // Optional: Stop if list is done
      return;
    }

    const nextClient = clients[nextClientIndex];
    logger.info(`Drip Service: Calling ${nextClient.name} (${nextClient.phone})...`);

    // Mark as CALLED immediately to avoid duplicates
    clients[nextClientIndex].status = 'CALLED';
    clients[nextClientIndex].lastCalled = new Date().toISOString();
    await writeJson('clients.json', clients);

    isCallInProgress = true;

    // Initiate Call
    await client.calls.create({
      url: `${config.server.publicUrl}/voice/outbound-twiml?context=outbound&callerId=${encodeURIComponent(nextClient.phone)}`,
      to: nextClient.phone,
      from: config.twilio.phoneNumber,
      statusCallback: `${config.server.publicUrl}/voice/status-callback`,
      statusCallbackEvent: ['completed', 'busy', 'no-answer', 'failed', 'canceled'],
      method: 'POST'
    });

  } catch (error) {
    logger.error('Drip Service Error:', error);
    isCallInProgress = false; // Release lock on error
  }
};
