import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import twilio from 'twilio';
import { config } from '../config/config.js';
import { getNextPendingClient, updateClientStatus } from './leadService.js';
import eventBus from '../utils/events.js';
import logger from '../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const TIMEZONE = config.drip.timezone;
let isRunning = false;
let callInProgress = false;

// Initialize Twilio Client
const client = twilio(config.twilio.accountSid, config.twilio.authToken);

export const checkTimeWindow = () => {
  const now = dayjs().tz(TIMEZONE);
  const currentTime = now.format('HH:mm');

  const morningStart = config.drip.morningWindow.start;
  const morningEnd = config.drip.morningWindow.end;
  const afternoonStart = config.drip.afternoonWindow.start;
  const afternoonEnd = config.drip.afternoonWindow.end;

  const isMorning = currentTime >= morningStart && currentTime <= morningEnd;
  const isAfternoon = currentTime >= afternoonStart && currentTime <= afternoonEnd;

  return isMorning || isAfternoon;
};

export const startDrip = async () => {
  if (isRunning) {
    logger.info('Drip service is already running.');
    return;
  }

  logger.info('Starting Drip Service...');
  isRunning = true;
  processNextCall();
};

export const stopDrip = () => {
  logger.info('Stopping Drip Service...');
  isRunning = false;
};

const processNextCall = async () => {
  if (!isRunning) return;

  if (!checkTimeWindow()) {
    logger.info('Outside of operating hours. Pausing Drip Service.');
    stopDrip();
    return;
  }

  if (callInProgress) {
    logger.info('Call currently in progress. Waiting...');
    return;
  }

  const clientToCall = await getNextPendingClient();

  if (!clientToCall) {
    logger.info('No pending clients found. Drip Service finished.');
    stopDrip();
    return;
  }

  try {
    // Mark as CALLED immediately
    await updateClientStatus(clientToCall.id, 'CALLED');

    logger.info(`Initiating call to ${clientToCall.name} (${clientToCall.phone})`);
    callInProgress = true;

    // Trigger Outbound Call
    await client.calls.create({
      url: `${config.server.publicUrl}/voice/incoming?direction=outbound&clientId=${clientToCall.id}&phone=${encodeURIComponent(clientToCall.phone)}`,
      to: clientToCall.phone,
      from: config.twilio.phoneNumber,
      machineDetection: 'Enable', // Detect voicemail
      statusCallback: `${config.server.publicUrl}/voice/status`,
      statusCallbackEvent: ['completed', 'busy', 'no-answer', 'failed', 'canceled']
    });

  } catch (error) {
    logger.error(`Error calling client ${clientToCall.id}:`, error);
    callInProgress = false;
    // Retry or log error, then process next after a delay?
    // For now, let's just wait a bit and try next to avoid infinite loop on error
    setTimeout(processNextCall, 5000);
  }
};

// Listen for call completion to trigger next
eventBus.on('callEnded', () => {
  logger.info('Call ended event received. Processing next call...');
  callInProgress = false;
  // Add a small delay before next call to be safe
  setTimeout(processNextCall, 5000);
});

// Start check on initialization (can be triggered by scheduler)
export const checkAndRun = () => {
    if(checkTimeWindow()) {
        startDrip();
    }
}
