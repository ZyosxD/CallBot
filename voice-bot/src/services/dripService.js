import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientsFile = path.join(__dirname, '../data/clients.json');

const client = twilio(config.twilio.accountSid, config.twilio.authToken);

let isCallInProgress = false;
let dripInterval = null;

export const loadClients = () => {
  try {
    const data = fs.readFileSync(clientsFile, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    logger.error('Error reading clients file:', error);
    return [];
  }
};

export const saveClients = (clients) => {
  try {
    fs.writeFileSync(clientsFile, JSON.stringify(clients, null, 2));
  } catch (error) {
    logger.error('Error saving clients file:', error);
  }
};

export const isWithinOperatingHours = () => {
  const now = dayjs().tz(config.operatingHours.timezone);
  const currentTime = now.format('HH:mm');

  // Morning Window
  if (currentTime >= config.operatingHours.morning.start && currentTime < config.operatingHours.morning.end) {
    return true;
  }

  // Afternoon Window
  if (currentTime >= config.operatingHours.afternoon.start && currentTime < config.operatingHours.afternoon.end) {
    return true;
  }

  return false;
};

export const makeNextCall = async () => {
  if (isCallInProgress) {
    logger.info('Call in progress, skipping drip cycle.');
    return;
  }

  if (!isWithinOperatingHours()) {
    logger.info('Outside operating hours.');
    return;
  }

  const clients = loadClients();
  const nextClient = clients.find(c => c.status === 'PENDING');

  if (!nextClient) {
    logger.info('No pending clients found.');
    return;
  }

  try {
    logger.info(`Initiating call to ${nextClient.name} (${nextClient.phone})`);
    isCallInProgress = true;

    // Update status to CALLED
    nextClient.status = 'CALLED';
    nextClient.lastCalled = new Date().toISOString();
    saveClients(clients);

    // Make the call
    await client.calls.create({
      url: `${config.server.publicUrl}/voice/outbound-twiml?clientId=${nextClient.id}`,
      to: nextClient.phone,
      from: config.twilio.phoneNumber,
      statusCallback: `${config.server.publicUrl}/voice/status-callback`,
      statusCallbackEvent: ['completed', 'busy', 'no-answer', 'failed', 'canceled'],
      statusCallbackMethod: 'POST'
    });

  } catch (error) {
    logger.error('Error initiating call:', error);
    isCallInProgress = false; // Release lock on error
  }
};

export const startDrip = () => {
  logger.info('Starting Smart Drip Service...');
  if (dripInterval) clearInterval(dripInterval);

  // Check every minute
  dripInterval = setInterval(makeNextCall, 60 * 1000);

  // Initial check
  makeNextCall();
};

export const stopDrip = () => {
  logger.info('Stopping Smart Drip Service...');
  if (dripInterval) clearInterval(dripInterval);
};

export const callEnded = () => {
  logger.info('Call ended, releasing lock.');
  isCallInProgress = false;
  // Immediately try next call if within hours
  if (isWithinOperatingHours()) {
      // Add a small delay to avoid race conditions or rapid firing
      setTimeout(makeNextCall, 5000);
  }
};
