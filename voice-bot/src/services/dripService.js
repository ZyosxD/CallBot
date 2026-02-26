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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENTS_FILE = path.join(__dirname, '../data/clients.json');

let dripInterval = null;
let isCallActive = false;

const client = twilio(config.twilio.accountSid, config.twilio.authToken);

const loadClients = () => {
  try {
    const data = fs.readFileSync(CLIENTS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    logger.error('Error reading clients file:', error);
    return [];
  }
};

const saveClients = (clients) => {
  try {
    fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));
  } catch (error) {
    logger.error('Error writing clients file:', error);
  }
};

export const setCallActive = (status) => {
  isCallActive = status;
  logger.info(`Call active status set to: ${status}`);
};

const isWithinOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const hour = now.hour();
  const minute = now.minute();

  // Morning: 9:30 - 11:30
  const isMorning = (hour === 9 && minute >= 30) || (hour === 10) || (hour === 11 && minute < 30);

  // Afternoon: 14:30 - 15:30
  const isAfternoon = (hour === 14 && minute >= 30) || (hour === 15 && minute < 30);

  return isMorning || isAfternoon;
};

const initiateCall = async (clientData) => {
  if (!config.server.publicUrl) {
    logger.warn('Public URL not set, cannot initiate call.');
    return;
  }

  try {
    logger.info(`Initiating call to ${clientData.name} (${clientData.phone})`);

    // Construct the URL that Twilio will request to get TwiML
    // We pass clientId to retrieve the client details later or just use the phone
    const url = `${config.server.publicUrl}/voice/outbound-twiml?clientId=${clientData.id}`;

    await client.calls.create({
      to: clientData.phone,
      from: config.twilio.phoneNumber,
      url: url,
      statusCallback: `${config.server.publicUrl}/voice/status-callback`,
      statusCallbackEvent: ['completed', 'busy', 'no-answer', 'failed', 'canceled']
    });

    setCallActive(true);
  } catch (error) {
    logger.error('Error initiating call:', error);
    setCallActive(false); // Reset if failed
  }
};

const processDrip = async () => {
  if (isCallActive) {
    logger.debug('Call currently active, skipping drip cycle.');
    return;
  }

  if (!isWithinOperatingHours()) {
    logger.debug('Outside operating hours.');
    return;
  }

  const clients = loadClients();
  const pendingClientIndex = clients.findIndex(c => c.status === 'PENDING');

  if (pendingClientIndex !== -1) {
    const pendingClient = clients[pendingClientIndex];

    // Mark as CALLED immediately to prevent duplicates
    clients[pendingClientIndex].status = 'CALLED';
    clients[pendingClientIndex].lastCalled = new Date().toISOString();
    saveClients(clients);

    await initiateCall(pendingClient);
  } else {
    logger.info('No pending clients found.');
  }
};

export const startDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
  }

  logger.info('Starting Smart Drip Service...');
  // Check every 30 seconds
  dripInterval = setInterval(processDrip, 30000);
  processDrip(); // Run immediately
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Smart Drip Service stopped.');
  }
};
