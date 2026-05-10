import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import isBetween from 'dayjs/plugin/isBetween.js';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isBetween);
dayjs.extend(customParseFormat);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLIENTS_FILE = path.join(__dirname, '../../clients.json');

let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const checkSchedule = () => {
  const now = dayjs().tz('America/Denver');
  const morningStart = now.hour(9).minute(30).second(0);
  const morningEnd = now.hour(11).minute(30).second(0);
  const afternoonStart = now.hour(14).minute(30).second(0); // 2:30 PM
  const afternoonEnd = now.hour(15).minute(30).second(0);   // 3:30 PM

  return now.isBetween(morningStart, morningEnd) || now.isBetween(afternoonStart, afternoonEnd);
};

const executeDrip = async () => {
  if (isCallActive) {
    logger.info('Drip Service: Call currently active. Skipping this cycle.');
    return;
  }

  if (!checkSchedule()) {
    logger.info('Drip Service: Outside of active hours. Waiting for next window.');
    return;
  }

  try {
    let clients = [];
    try {
      const data = await fs.readFile(CLIENTS_FILE, 'utf-8');
      clients = JSON.parse(data);
    } catch (error) {
      logger.error('Drip Service: Failed to read clients.json', error);
      return;
    }

    const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (nextClientIndex === -1) {
      logger.info('Drip Service: No pending clients found. Waiting.');
      return;
    }

    const nextClient = clients[nextClientIndex];

    // Mark as called immediately to avoid mathematical duplicates
    clients[nextClientIndex].status = 'CALLED';
    await fs.writeFile(CLIENTS_FILE, JSON.stringify(clients, null, 2));

    logger.info(`Drip Service: Initiating call to ${nextClient.phone}`);
    isCallActive = true;

    const client = twilio(config.twilio.accountSid, config.twilio.authToken);

    // Encode phone number to be passed in the URL, as TwiML URL
    const callerId = encodeURIComponent(nextClient.phone);

    const call = await client.calls.create({
      url: `${config.server.publicUrl}/voice/outbound?callerId=${callerId}`,
      to: nextClient.phone,
      from: config.twilio.phoneNumber,
      // Do NOT restrict statusCallbackEvent with an array
      statusCallback: `${config.server.publicUrl}/voice/outbound/status`,
      statusCallbackMethod: 'POST'
    });

    activeCallSid = call.sid;
    logger.info(`Drip Service: Call initiated successfully. CallSid: ${activeCallSid}`);

  } catch (error) {
    logger.error('Drip Service: Error during drip execution', error);
    isCallActive = false;
    activeCallSid = null;
  }
};

export const startDrip = () => {
  if (dripInterval) {
    logger.warn('Drip Service: Already running.');
    return;
  }
  logger.info('Drip Service: Starting Smart Drip engine.');
  // Check every 30 seconds
  dripInterval = setInterval(executeDrip, 30000);
  // Run once immediately
  executeDrip();
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Drip Service: Stopped.');
  }
};

export const releaseCallLock = (callSid) => {
  if (activeCallSid === callSid) {
    logger.info(`Drip Service: Releasing lock for CallSid: ${callSid}`);
    isCallActive = false;
    activeCallSid = null;
  } else {
    logger.info(`Drip Service: Ignored lock release for mismatch/inbound CallSid: ${callSid}`);
  }
};
