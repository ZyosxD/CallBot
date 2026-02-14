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

let dripInterval = null;
let callInProgress = false;

const client = twilio(config.twilio.accountSid, config.twilio.authToken);

export const startDrip = () => {
  if (dripInterval) return;

  logger.info('Starting Smart Drip Engine...');

  // Check every 30 seconds
  dripInterval = setInterval(checkAndCall, 30000);
  checkAndCall(); // Run immediately
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Stopped Smart Drip Engine.');
  }
};

export const markCallEnded = () => {
  callInProgress = false;
  logger.info('Call ended. Drip engine ready for next call.');
};

const checkAndCall = async () => {
  if (callInProgress) {
    logger.info('Drip: Call in progress, skipping...');
    return;
  }

  if (!isWithinOperatingHours()) {
    logger.info('Drip: Outside operating hours.');
    return;
  }

  try {
    const clients = JSON.parse(fs.readFileSync(CLIENTS_FILE, 'utf8'));
    const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (nextClientIndex === -1) {
      logger.info('Drip: No pending clients found.');
      return;
    }

    const nextClient = clients[nextClientIndex];
    logger.info(`Drip: Initiating call to ${nextClient.name} (${nextClient.company})...`);

    // Mark as CALLED immediately
    clients[nextClientIndex].status = 'CALLED';
    fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));

    callInProgress = true;
    await makeCall(nextClient);

  } catch (error) {
    logger.error('Drip Error:', error);
    callInProgress = false; // Release lock on error
  }
};

const isWithinOperatingHours = () => {
  const now = dayjs().tz(config.drip.timezone);
  const currentHour = now.hour();
  const currentMinute = now.minute();

  const { morningStart, morningEnd, afternoonStart, afternoonEnd } = config.drip;

  const isMorning = (
    (currentHour > morningStart.hour || (currentHour === morningStart.hour && currentMinute >= morningStart.minute)) &&
    (currentHour < morningEnd.hour || (currentHour === morningEnd.hour && currentMinute < morningEnd.minute))
  );

  const isAfternoon = (
    (currentHour > afternoonStart.hour || (currentHour === afternoonStart.hour && currentMinute >= afternoonStart.minute)) &&
    (currentHour < afternoonEnd.hour || (currentHour === afternoonEnd.hour && currentMinute < afternoonEnd.minute))
  );

  return isMorning || isAfternoon;
};

const makeCall = async (clientData) => {
  try {
    const callbackUrl = `${config.server.publicUrl}/voice/outbound-twiml?phone=${encodeURIComponent(clientData.phone)}&name=${encodeURIComponent(clientData.name)}&company=${encodeURIComponent(clientData.company)}`;

    // We need to trigger our own TwiML generation that connects to the stream
    // Since we can't easily pass query params to the TwiML App URL in the call creation directly effectively without a proxy,
    // we point the 'url' to our server which returns the Stream TwiML.

    await client.calls.create({
      to: clientData.phone,
      from: config.twilio.phoneNumber,
      url: callbackUrl,
      statusCallback: `${config.server.publicUrl}/voice/status-callback`,
      statusCallbackEvent: ['completed', 'busy', 'no-answer', 'failed']
    });

    logger.info(`Call initiated to ${clientData.phone}`);
  } catch (error) {
    logger.error(`Failed to initiate call to ${clientData.phone}:`, error);
    callInProgress = false;
  }
};
