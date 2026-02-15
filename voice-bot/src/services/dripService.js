import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';
import { readJsonFile, writeJsonFile } from '../utils/fileHelper.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const CLIENTS_FILE = 'src/data/clients.json';
const MOUNTAIN_TZ = 'America/Denver';

let isCallActive = false;
let dripInterval = null;

const client = twilio(config.twilio.accountSid, config.twilio.authToken);

export const startDripService = () => {
  if (dripInterval) {
    logger.warn('Drip service already running.');
    return;
  }

  logger.info('Starting Smart Drip Service...');

  // Check every minute
  dripInterval = setInterval(checkAndCall, 60000);
  checkAndCall(); // Run immediately
};

export const stopDripService = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Drip service stopped.');
  }
};

export const notifyCallEnded = () => {
  logger.info('Call ended signal received. Releasing concurrency lock.');
  isCallActive = false;
  // Optionally trigger next check immediately, but interval is fine
};

const checkAndCall = async () => {
  try {
    if (isCallActive) {
      logger.info('Drip check: Call currently active. Skipping.');
      return;
    }

    const now = dayjs().tz(MOUNTAIN_TZ);
    const currentHour = now.hour();
    const currentMinute = now.minute();

    // Operating Hours:
    // Morning: 9:30 - 11:30
    // Afternoon: 14:30 - 15:30 (2:30 PM - 3:30 PM)

    const isMorningSlot = (currentHour === 9 && currentMinute >= 30) || (currentHour === 10) || (currentHour === 11 && currentMinute < 30);
    const isAfternoonSlot = (currentHour === 14 && currentMinute >= 30) || (currentHour === 15 && currentMinute < 30);

    if (!isMorningSlot && !isAfternoonSlot) {
      logger.info(`Drip check: Outside operating hours (${now.format('HH:mm')} MT).`);
      return;
    }

    logger.info('Drip check: Within operating hours. Looking for pending clients...');

    const clients = readJsonFile(CLIENTS_FILE);
    const pendingClientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (pendingClientIndex === -1) {
      logger.info('No PENDING clients found.');
      return;
    }

    const targetClient = clients[pendingClientIndex];
    logger.info(`Found pending client: ${targetClient.name} (${targetClient.phone})`);

    // Mark as CALLED immediately
    clients[pendingClientIndex].status = 'CALLED';
    clients[pendingClientIndex].lastCalledAt = now.toISOString();
    writeJsonFile(CLIENTS_FILE, clients);

    // Initiate Call
    isCallActive = true;
    await makeOutboundCall(targetClient);

  } catch (error) {
    logger.error('Error in drip service loop:', error);
    isCallActive = false; // Release lock on error
  }
};

const makeOutboundCall = async (clientData) => {
  try {
    const callbackUrl = \`\${config.server.publicUrl}/voice/outbound-twiml?clientId=\${clientData.id}\`;
    const statusCallbackUrl = \`\${config.server.publicUrl}/voice/status\`;

    logger.info(\`Initiating call to \${clientData.phone}...\`);

    await client.calls.create({
      to: clientData.phone,
      from: config.twilio.phoneNumber,
      url: callbackUrl,
      statusCallback: statusCallbackUrl,
      statusCallbackEvent: ['completed', 'failed', 'busy', 'no-answer'],
      machineDetection: 'Enable' // Optional: for voicemail detection
    });

    logger.info('Call initiated successfully.');
  } catch (error) {
    logger.error('Failed to initiate call:', error);
    isCallActive = false; // Release lock if call creation failed
    // Optionally revert status to PENDING?
    // For now, we leave it as CALLED to avoid infinite loop on bad numbers
  }
};
