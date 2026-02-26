import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENTS_FILE = path.join(__dirname, '../data/clients.json');
const TIMEZONE = 'America/Denver';

let isCallActive = false;
let dripInterval = null;

const client = twilio(config.twilio.accountSid, config.twilio.authToken);

export const startDrip = () => {
  if (dripInterval) return;

  logger.info('Starting Smart Drip Engine...');

  // Check every minute
  dripInterval = setInterval(async () => {
    await processDrip();
  }, 60 * 1000);

  // Initial check
  processDrip();
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Stopped Smart Drip Engine.');
  }
};

export const onCallEnded = () => {
  logger.info('Call ended signal received. Releasing lock.');
  isCallActive = false;
};

const processDrip = async () => {
  if (isCallActive) {
    logger.info('Drip skipped: Call currently active.');
    return;
  }

  if (!isWithinOperatingHours()) {
    logger.info('Drip skipped: Outside operating hours.');
    return;
  }

  try {
    const clientsData = await fs.readFile(CLIENTS_FILE, 'utf-8');
    const clients = JSON.parse(clientsData);

    const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (nextClientIndex === -1) {
      logger.info('Drip skipped: No pending clients found.');
      return;
    }

    const nextClient = clients[nextClientIndex];
    logger.info(`Initiating call for client: ${nextClient.name} (${nextClient.phone})`);

    // Update status immediately to avoid duplicates
    clients[nextClientIndex].status = 'CALLED';
    clients[nextClientIndex].calledAt = new Date().toISOString();
    await fs.writeFile(CLIENTS_FILE, JSON.stringify(clients, null, 2));

    // Initiate Call
    isCallActive = true;
    await makeCall(nextClient);

  } catch (error) {
    logger.error('Error in Drip process:', error);
    isCallActive = false; // Release lock on error
  }
};

const isWithinOperatingHours = () => {
  const now = dayjs().tz(TIMEZONE);
  const hour = now.hour();
  const minute = now.minute();

  // Morning: 09:30 - 11:30
  const isMorning = (hour === 9 && minute >= 30) || (hour === 10) || (hour === 11 && minute < 30);

  // Afternoon: 14:30 - 15:30 (2:30 PM - 3:30 PM)
  const isAfternoon = (hour === 14 && minute >= 30) || (hour === 15 && minute < 30);

  return isMorning || isAfternoon;
};

const makeCall = async (targetClient) => {
  if (!config.server.publicUrl) {
      logger.error('Public URL is not configured. Cannot make call.');
      isCallActive = false;
      return;
  }

  try {
    // We pass the client phone as callerId to the TwiML generator for correct logging and comparison
    const call = await client.calls.create({
      url: `${config.server.publicUrl}/voice/outbound-twiml?callerId=${encodeURIComponent(targetClient.phone)}`,
      to: targetClient.phone,
      from: config.twilio.phoneNumber,
      statusCallback: `${config.server.publicUrl}/voice/status-callback`,
      statusCallbackEvent: ['completed', 'busy', 'no-answer', 'failed']
    });

    logger.info(`Call initiated. SID: ${call.sid}`);
  } catch (error) {
    logger.error('Twilio Call Error:', error);
    isCallActive = false;
  }
};
