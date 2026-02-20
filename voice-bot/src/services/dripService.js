import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import twilio from 'twilio';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';
import { readJsonFile, writeJsonFile } from '../utils/fileLock.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLIENTS_FILE = path.join(__dirname, '../data/clients.json');

const client = twilio(config.twilio.accountSid, config.twilio.authToken);

let isRunning = false;
let isCallInProgress = false;
let currentCallSid = null;
let dripInterval = null;

const TIMEZONE = config.operatingHours.timezone;

const isWithinOperatingHours = () => {
  const now = dayjs().tz(TIMEZONE);
  const time = now.format('HH:mm');

  const morningStart = config.operatingHours.morning.start;
  const morningEnd = config.operatingHours.morning.end;
  const afternoonStart = config.operatingHours.afternoon.start;
  const afternoonEnd = config.operatingHours.afternoon.end;

  const isMorning = time >= morningStart && time < morningEnd;
  const isAfternoon = time >= afternoonStart && time < afternoonEnd;

  return isMorning || isAfternoon;
};

const makeNextCall = async () => {
  const isTime = isWithinOperatingHours();

  if (!isTime) {
    if (isCallInProgress && currentCallSid) {
       logger.info('Operating hours ended. Terminating active call.');
       try {
           await client.calls(currentCallSid).update({ status: 'completed' });
           // We don't reset strictly here, let the status callback handle it
           // But just in case status callback fails or is delayed:
           // isCallInProgress = false;
           // currentCallSid = null;
       } catch (err) {
           logger.error(`Error terminating call ${currentCallSid}:`, err);
       }
    }
    return;
  }

  if (isCallInProgress) {
    return;
  }

  try {
    const clients = await readJsonFile(CLIENTS_FILE);
    const pendingClientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (pendingClientIndex === -1) {
      // No pending clients, just return
      return;
    }

    const pendingClient = clients[pendingClientIndex];

    // Mark as CALLED immediately
    clients[pendingClientIndex].status = 'CALLED';
    await writeJsonFile(CLIENTS_FILE, clients);

    logger.info(`Initiating call to ${pendingClient.name} (${pendingClient.phone})`);

    isCallInProgress = true;

    // Initiate Call
    // We pass the name as a query param so the TwiML can use it if needed
    // But mostly we need it for the context
    const call = await client.calls.create({
      to: pendingClient.phone,
      from: config.twilio.phoneNumber,
      // We need a TwiML URL that connects to the stream
      url: `${config.server.publicUrl}/voice/outbound-twiml?name=${encodeURIComponent(pendingClient.name)}`,
      statusCallback: `${config.server.publicUrl}/voice/status-callback`,
      statusCallbackEvent: ['completed', 'busy', 'no-answer', 'failed', 'canceled'],
      statusCallbackMethod: 'POST'
    });

    currentCallSid = call.sid;
    logger.info(`Call initiated: ${call.sid}`);

  } catch (error) {
    logger.error('Error in makeNextCall:', error);
    isCallInProgress = false;
    currentCallSid = null;
  }
};

export const startDrip = () => {
  if (isRunning) return;
  isRunning = true;
  logger.info('Starting Smart Drip Service...');

  // Check every 30 seconds
  dripInterval = setInterval(makeNextCall, 30000);
  makeNextCall(); // Run immediately
};

export const stopDrip = () => {
  if (!isRunning) return;
  isRunning = false;
  if (dripInterval) clearInterval(dripInterval);
  dripInterval = null;
  logger.info('Stopping Smart Drip Service...');
};

export const handleCallEnded = (callSid) => {
  if (callSid === currentCallSid) {
    logger.info(`Call ended: ${callSid}`);
    isCallInProgress = false;
    currentCallSid = null;

    // Trigger next call logic after a short delay
    if (isRunning) {
        setTimeout(makeNextCall, 5000);
    }
  }
};
