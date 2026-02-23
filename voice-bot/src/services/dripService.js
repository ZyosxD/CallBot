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
const CLIENTS_FILE = path.join(__dirname, '../data/clients.json');

let dripInterval = null;
let isCallActive = false;

const loadClients = () => {
  try {
    const data = fs.readFileSync(CLIENTS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    logger.error('Error loading clients:', error);
    return [];
  }
};

const saveClients = (clients) => {
  try {
    fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));
  } catch (error) {
    logger.error('Error saving clients:', error);
  }
};

const isWithinOperatingHours = () => {
  const now = dayjs().tz("America/Denver");
  const hour = now.hour();
  const minute = now.minute();

  // Morning: 9:30 - 11:30
  const isMorning = (hour === 9 && minute >= 30) || (hour === 10) || (hour === 11 && minute < 30);

  // Afternoon: 14:30 - 15:30 (2:30 PM - 3:30 PM)
  const isAfternoon = (hour === 14 && minute >= 30) || (hour === 15 && minute < 30);

  return isMorning || isAfternoon;
};

const makeCall = async (client) => {
  if (isCallActive) {
    logger.info('Call already active, skipping.');
    return;
  }

  isCallActive = true;
  logger.info(`Initiating call to ${client.name} (${client.phone})`);

  try {
    const clientTwilio = twilio(config.twilio.accountSid, config.twilio.authToken);

    // Construct the TwiML inline or point to an endpoint that returns TwiML
    // Pointing to the endpoint allows us to handle the stream connection there.
    // We pass callerId as a query param or handle it in the controller.
    // Here we will use the 'url' parameter to point to our server's /voice/connect endpoint
    // But wait, the server usually handles incoming. For outbound, we need to tell Twilio where to fetch TwiML.

    const publicUrl = config.server.publicUrl;
    if (!publicUrl) {
      logger.warn('Public URL not set, cannot make outbound call.');
      isCallActive = false;
      return;
    }

    const call = await clientTwilio.calls.create({
      url: `${publicUrl}/voice/outbound-twiml?callerId=${encodeURIComponent(client.phone)}`,
      to: client.phone,
      from: config.twilio.phoneNumber,
      statusCallback: `${publicUrl}/voice/status-callback`,
      statusCallbackEvent: ['completed', 'busy', 'no-answer', 'failed', 'canceled']
    });

    logger.info(`Call initiated: ${call.sid}`);

  } catch (error) {
    logger.error('Error making call:', error);
    isCallActive = false; // Release lock on error
  }
};

export const startDrip = () => {
  if (dripInterval) return;

  logger.info('Starting Smart Drip Service...');

  // Check every minute
  dripInterval = setInterval(() => {
    if (!isWithinOperatingHours()) {
      // If we are outside hours and a call is active, it should be handled/terminated by the call logic or max duration.
      // But strictly, we just don't start new ones.
      return;
    }

    if (isCallActive) return;

    const clients = loadClients();
    const pendingClientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (pendingClientIndex !== -1) {
      const client = clients[pendingClientIndex];

      // Update status immediately to avoid duplicates
      clients[pendingClientIndex].status = 'CALLED';
      saveClients(clients);

      makeCall(client);
    } else {
      logger.info('No pending clients found.');
    }

  }, 60 * 1000); // Check every 60 seconds
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Drip Service stopped.');
  }
};

export const releaseLock = () => {
  logger.info('Releasing call lock.');
  isCallActive = false;
};
