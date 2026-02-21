import twilio from 'twilio';
import dayjs from 'dayjs';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';
import { readJsonFile, updateJsonFile } from '../utils/fileLock.js';

const client = twilio(config.twilio.accountSid, config.twilio.authToken);
const CLIENTS_FILE = 'src/data/clients.json';

let isCallActive = false;
let dripInterval = null;

export const startDrip = () => {
  if (dripInterval) return;
  logger.info('Starting Smart Drip Service...');
  // Initial check after 5 seconds to let server start
  setTimeout(checkAndCall, 5000);
  dripInterval = setInterval(checkAndCall, 60000); // Check every minute
};

export const stopDrip = () => {
  if (dripInterval) clearInterval(dripInterval);
  dripInterval = null;
  logger.info('Stopping Smart Drip Service...');
};

export const handleCallEnded = () => {
  logger.info('Call ended. Releasing lock.');
  isCallActive = false;
};

const checkAndCall = async () => {
  if (isCallActive) {
    logger.info('Call in progress. Skipping drip check.');
    return;
  }

  const now = dayjs().tz('America/Denver');
  const currentHour = now.hour();
  const currentMinute = now.minute();

  // Morning: 9:30 - 11:30
  const isMorning = (currentHour === 9 && currentMinute >= 30) || (currentHour === 10) || (currentHour === 11 && currentMinute < 30);
  // Afternoon: 14:30 - 15:30 (2:30 PM - 3:30 PM)
  const isAfternoon = (currentHour === 14 && currentMinute >= 30) || (currentHour === 15 && currentMinute < 30);

  // Allow manual override or force run if needed via env or just log
  if (!isMorning && !isAfternoon) {
    // logger.debug(`Outside operating hours (${now.format('HH:mm')}). Waiting.`);
    return;
  }

  try {
    const clients = await readJsonFile(CLIENTS_FILE);
    const nextClient = clients.find(c => c.status === 'PENDING');

    if (!nextClient) {
      logger.info('No pending clients found.');
      return;
    }

    logger.info(`Initiating call to ${nextClient.name} (${nextClient.phone})...`);

    // Mark as CALLED immediately
    await updateJsonFile(CLIENTS_FILE, (data) => {
        const clientIndex = data.findIndex(c => c.id === nextClient.id);
        if (clientIndex !== -1) {
            data[clientIndex].status = 'CALLED';
        }
        return data;
    });

    isCallActive = true;

    // Make the call
    // Note: The URL must be absolute.
    const url = `${config.server.publicUrl}/voice/outbound-twiml?callerId=${encodeURIComponent(nextClient.phone)}`;
    const statusCallback = `${config.server.publicUrl}/voice/status-callback`;

    await client.calls.create({
      url: url,
      to: nextClient.phone,
      from: config.twilio.phoneNumber,
      statusCallback: statusCallback,
      statusCallbackEvent: ['completed', 'busy', 'no-answer', 'failed']
    });

  } catch (error) {
    logger.error('Error in drip loop:', error);
    isCallActive = false; // Release lock on error
  }
};
