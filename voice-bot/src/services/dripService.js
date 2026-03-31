import fs from 'fs';
import path from 'path';
import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { fileURLToPath } from 'url';

dayjs.extend(utc);
dayjs.extend(timezone);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientsPath = path.join(__dirname, '../data/clients.json');

let dripInterval = null;
let isCallActive = false;
let activeCallSid = null;

const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

export const isWithinOperatingHours = () => {
  const denverTime = dayjs().tz('America/Denver');
  const hour = denverTime.hour();
  const minute = denverTime.minute();

  const timeInMinutes = hour * 60 + minute;

  // Morning: 9:30 AM (570) to 11:30 AM (690)
  const morningStart = 9 * 60 + 30;
  const morningEnd = 11 * 60 + 30;

  // Afternoon: 2:30 PM (870) to 3:30 PM (930)
  const afternoonStart = 14 * 60 + 30;
  const afternoonEnd = 15 * 60 + 30;

  return (timeInMinutes >= morningStart && timeInMinutes <= morningEnd) ||
         (timeInMinutes >= afternoonStart && timeInMinutes <= afternoonEnd);
};

export const startDrip = () => {
  if (dripInterval) {
    logger.warn('Drip is already running.');
    return;
  }

  logger.info('Starting Smart Drip polling interval...');
  // Check every 30 seconds
  dripInterval = setInterval(processNextCall, 30000);
  processNextCall();
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Smart Drip polling interval stopped.');
  }
};

export const markCallEnded = (callSid) => {
  if (callSid === activeCallSid) {
    logger.info(`Call ${callSid} ended, releasing lock.`);
    isCallActive = false;
    activeCallSid = null;
  }
};

const processNextCall = async () => {
  if (!isWithinOperatingHours()) {
    logger.info('Outside operating hours. Waiting...');
    return;
  }

  if (isCallActive) {
    logger.info('A call is currently active. Waiting...');
    return;
  }

  try {
    if (!fs.existsSync(clientsPath)) {
        logger.error('clients.json not found!');
        return;
    }

    const rawData = fs.readFileSync(clientsPath, 'utf-8');
    const clients = JSON.parse(rawData);

    const pendingClientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (pendingClientIndex === -1) {
      logger.info('No more PENDING clients in the database.');
      return;
    }

    const targetClient = clients[pendingClientIndex];
    logger.info(`Found pending client: ${targetClient.phone}. Initiating call...`);

    // Mark as called immediately before placing the call to avoid duplicates
    clients[pendingClientIndex].status = 'CALLED';
    fs.writeFileSync(clientsPath, JSON.stringify(clients, null, 2), 'utf-8');

    isCallActive = true;

    // Use absolute URL for the twiml stream to avoid API conflicts
    const twimlUrl = new URL('/voice/inbound', config.server.publicUrl).href;

    // We pass callerId to our inbound endpoint so our server knows who we are calling
    const call = await twilioClient.calls.create({
      url: `${twimlUrl}?callerId=${encodeURIComponent(targetClient.phone)}`,
      to: targetClient.phone,
      from: config.twilio.phoneNumber,
      statusCallback: `${config.server.publicUrl}/voice/status`,
    });

    activeCallSid = call.sid;
    logger.info(`Outbound call initiated. CallSid: ${activeCallSid}`);

  } catch (error) {
    logger.error('Error processing next outbound call:', error);
    isCallActive = false;
  }
};
