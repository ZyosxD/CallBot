import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import fs from 'fs';
import path from 'path';
import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';
import { fileURLToPath } from 'url';

dayjs.extend(utc);
dayjs.extend(timezone);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENTS_FILE = path.join(__dirname, '../data/clients.json');

let dripInterval = null;
let isCallActive = false;

const client = twilio(config.twilio.accountSid, config.twilio.authToken);

const isWithinOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const hour = now.hour();
  const minute = now.minute();

  // Morning: 9:30 AM - 11:30 AM
  const isMorning = (hour === 9 && minute >= 30) || (hour === 10) || (hour === 11 && minute < 30);

  // Afternoon: 2:30 PM - 3:30 PM (14:30 - 15:30)
  const isAfternoon = (hour === 14 && minute >= 30) || (hour === 15 && minute < 30);

  return isMorning || isAfternoon;
};

const getPendingClient = () => {
  try {
    const data = fs.readFileSync(CLIENTS_FILE, 'utf8');
    const clients = JSON.parse(data);
    return clients.find(c => c.status === 'PENDING');
  } catch (error) {
    logger.error('Error reading clients file:', error);
    return null;
  }
};

const updateClientStatus = (clientId, status) => {
  try {
    const data = fs.readFileSync(CLIENTS_FILE, 'utf8');
    const clients = JSON.parse(data);
    const index = clients.findIndex(c => c.id === clientId);
    if (index !== -1) {
      clients[index].status = status;
      fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));
    }
  } catch (error) {
    logger.error('Error updating client status:', error);
  }
};

const makeNextCall = async () => {
  if (isCallActive) {
    logger.info('Call currently active, skipping drip cycle.');
    return;
  }

  if (!isWithinOperatingHours()) {
    logger.info('Outside operating hours.');
    // Optional: Check if we need to terminate active calls if strictly enforced,
    // but the spec says "Termina respetuosamente", which implies the bot logic handles ending it,
    // or we force hangup. For now, we just don't start new ones.
    return;
  }

  const nextClient = getPendingClient();
  if (!nextClient) {
    logger.info('No pending clients found.');
    return;
  }

  logger.info(`Initiating call for client: ${nextClient.name} (${nextClient.phone})`);

  // Mark as CALLED immediately
  updateClientStatus(nextClient.id, 'CALLED');
  isCallActive = true;

  try {
    const call = await client.calls.create({
      url: `${config.server.publicUrl}/voice/outbound-twiml`, // We will create this route
      to: nextClient.phone,
      from: config.twilio.phoneNumber,
      statusCallback: `${config.server.publicUrl}/voice/status-callback`,
      statusCallbackEvent: ['completed', 'busy', 'no-answer', 'failed', 'canceled']
    });

    logger.info(`Call initiated: ${call.sid}`);

  } catch (error) {
    logger.error('Error initiating call:', error);
    isCallActive = false;
    // Maybe mark as FAILED or reset to PENDING?
    // Spec doesn't specify retry logic, so we leave it as CALLED to avoid loops.
  }
};

export const startDrip = () => {
  if (dripInterval) {
    logger.warn('Drip service already running.');
    return;
  }

  logger.info('Starting Drip Service...');
  // Check every minute
  dripInterval = setInterval(makeNextCall, 60 * 1000);
  // Also run immediately
  makeNextCall();
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Drip Service stopped.');
  }
};

export const callEnded = () => {
  logger.info('Call ended, releasing lock.');
  isCallActive = false;
};
