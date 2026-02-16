import fs from 'fs';
import path from 'path';
import twilio from 'twilio';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { config } from '../config/config.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLIENTS_FILE = path.join(__dirname, '../data/clients.json');

let callActive = false;
let nextCallTimeout = null;

// Initialize Twilio Client
// Ensure config has twilio credentials populated from .env
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

export const notifyCallEnded = () => {
  logger.info('Call ended signal received.');
  callActive = false;
};

const getPendingClient = () => {
  try {
    if (!fs.existsSync(CLIENTS_FILE)) return null;
    const data = fs.readFileSync(CLIENTS_FILE, 'utf8');
    const clients = JSON.parse(data);
    return clients.find(c => c.status === 'PENDING');
  } catch (error) {
    logger.error('Error reading clients file:', error);
    return null;
  }
};

const updateClientStatus = (id, status) => {
  try {
    const data = fs.readFileSync(CLIENTS_FILE, 'utf8');
    let clients = JSON.parse(data);
    const index = clients.findIndex(c => c.id == id); // Loose equality for string/number match
    if (index !== -1) {
      clients[index].status = status;
      fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));
    }
  } catch (error) {
    logger.error('Error updating client status:', error);
  }
};

const checkOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const hour = now.hour();
  const minute = now.minute();

  // Morning: 9:30 - 11:30
  if (hour === 9 && minute >= 30) return true;
  if (hour === 10) return true;
  if (hour === 11 && minute < 30) return true;

  // Afternoon: 14:30 - 15:30 (2:30 PM - 3:30 PM)
  if (hour === 14 && minute >= 30) return true;
  if (hour === 15 && minute < 30) return true;

  return false;
};

const attemptNextCall = async () => {
  if (callActive) {
    logger.info('Drip Service: Call in progress. Skipping...');
    return;
  }

  if (!checkOperatingHours()) {
    logger.info('Drip Service: Outside operating hours.');
    return;
  }

  const nextClient = getPendingClient();
  if (!nextClient) {
    logger.info('Drip Service: No pending clients.');
    return;
  }

  // Double check preventing race conditions
  if (callActive) return;

  try {
    logger.info(`Drip Service: Initiating call to ${nextClient.name} (${nextClient.phone})...`);
    callActive = true;
    updateClientStatus(nextClient.id, 'CALLED');

    if (!config.server.publicUrl) {
        logger.warn('PUBLIC_URL is not set. Cannot initiate outbound call.');
        callActive = false;
        return;
    }

    // Initiate Call
    const call = await client.calls.create({
      url: `${config.server.publicUrl}/voice/outbound-twiml?clientId=${nextClient.id}`,
      to: nextClient.phone,
      from: config.twilio.phoneNumber,
      statusCallback: `${config.server.publicUrl}/voice/status`,
      statusCallbackEvent: ['completed', 'busy', 'no-answer', 'failed', 'canceled'],
      statusCallbackMethod: 'POST'
    });

    logger.info(`Call initiated: ${call.sid}`);

  } catch (error) {
    logger.error('Error initiating call:', error);
    callActive = false; // Reset if failed
  }
};

export const startDrip = () => {
  logger.info('Starting Smart Drip Service...');
  // Check every minute
  setInterval(attemptNextCall, 60000);
  // Initial check
  attemptNextCall();
};

export const stopDrip = () => {
    if (nextCallTimeout) clearTimeout(nextCallTimeout);
};
