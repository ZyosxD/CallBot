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
const clientsFilePath = path.join(__dirname, '../data/clients.json');

let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const loadClients = () => {
  try {
    const data = fs.readFileSync(clientsFilePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    logger.error('Error reading clients file:', error);
    return [];
  }
};

const saveClients = (clients) => {
  try {
    fs.writeFileSync(clientsFilePath, JSON.stringify(clients, null, 2));
  } catch (error) {
    logger.error('Error writing clients file:', error);
  }
};

const isWithinOperatingHours = () => {
  const nowInDenver = dayjs().tz('America/Denver');
  const hour = nowInDenver.hour();
  const minute = nowInDenver.minute();

  const timeInMinutes = hour * 60 + minute;
  const morningStart = 9 * 60 + 30; // 9:30 AM
  const morningEnd = 11 * 60 + 30;  // 11:30 AM
  const afternoonStart = 14 * 60 + 30; // 2:30 PM
  const afternoonEnd = 15 * 60 + 30;   // 3:30 PM

  return (timeInMinutes >= morningStart && timeInMinutes <= morningEnd) ||
         (timeInMinutes >= afternoonStart && timeInMinutes <= afternoonEnd);
};

const processNextCall = async () => {
  if (isCallActive) {
    logger.info('Drip engine: A call is already active, skipping.');
    return;
  }

  if (!isWithinOperatingHours()) {
    logger.info('Drip engine: Outside operating hours, waiting.');
    return;
  }

  const clients = loadClients();
  const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

  if (nextClientIndex === -1) {
    logger.info('Drip engine: No pending clients found, waiting.');
    return;
  }

  const client = clients[nextClientIndex];

  try {
    isCallActive = true;
    const clientPhone = client.phone; // Assuming clients have a phone property

    // Mark as called BEFORE initiating to avoid mathematical duplicates
    clients[nextClientIndex].status = 'CALLED';
    saveClients(clients);

    const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

    // Pass client phone as callerId to generate outbound TwiML URL
    const publicUrl = config.server.publicUrl || 'http://localhost:' + config.server.port;
    const twimlUrl = `${publicUrl}/voice/inbound?callerId=${encodeURIComponent(clientPhone)}&mode=outbound`;

    const call = await twilioClient.calls.create({
      to: clientPhone,
      from: config.twilio.phoneNumber,
      url: twimlUrl,
      statusCallback: `${publicUrl}/voice/inbound/status`,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed', 'busy', 'failed', 'no-answer', 'canceled']
    });

    activeCallSid = call.sid;
    logger.info(`Drip engine: Initiated call ${call.sid} to ${clientPhone}`);

  } catch (error) {
    logger.error('Error initiating outbound call:', error);
    isCallActive = false;
    activeCallSid = null;
    // Potentially revert status on failure if needed, but per specs we mark before calling to prevent duplicates.
  }
};

export const startDrip = () => {
  if (dripInterval) {
    logger.info('Drip engine is already running.');
    return;
  }
  logger.info('Starting Smart Drip engine...');
  // Poll every 30 seconds
  dripInterval = setInterval(processNextCall, 30000);
  // Run once immediately
  processNextCall();
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Stopped Smart Drip engine.');
  }
};

export const releaseCallLock = (callSid) => {
  if (callSid === activeCallSid) {
    logger.info(`Releasing call lock for ${callSid}`);
    isCallActive = false;
    activeCallSid = null;
  }
};
