import fs from 'fs';
import path from 'path';
import twilio from 'twilio';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import isBetween from 'dayjs/plugin/isBetween.js';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isBetween);

let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const clientsPath = path.resolve('src/data/clients.json');

const getTwilioClient = () => {
  return twilio(config.twilio.accountSid, config.twilio.authToken);
};

const isWithinOperatingHours = () => {
  const now = dayjs().tz('America/Denver');

  const morningStart = now.hour(9).minute(30).second(0);
  const morningEnd = now.hour(11).minute(30).second(0);

  const afternoonStart = now.hour(14).minute(30).second(0);
  const afternoonEnd = now.hour(15).minute(30).second(0);

  return now.isBetween(morningStart, morningEnd, null, '[]') ||
         now.isBetween(afternoonStart, afternoonEnd, null, '[]');
};

const processNextCall = async () => {
  if (isCallActive) {
    logger.debug('Smart Drip: Call is currently active. Waiting...');
    return;
  }

  if (!isWithinOperatingHours()) {
    logger.debug('Smart Drip: Outside of operating hours (Denver Time). Waiting...');
    return;
  }

  let clients = [];
  try {
    if (fs.existsSync(clientsPath)) {
      clients = JSON.parse(fs.readFileSync(clientsPath, 'utf-8'));
    }
  } catch (error) {
    logger.error('Smart Drip: Error reading clients.json', error);
    return;
  }

  const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

  if (nextClientIndex === -1) {
    logger.debug('Smart Drip: No pending clients found. Waiting...');
    return;
  }

  const client = clients[nextClientIndex];

  // Set lock before API call
  isCallActive = true;

  try {
    const twilioClient = getTwilioClient();
    const publicUrl = config.server.publicUrl;

    if (!publicUrl) {
      throw new Error('PUBLIC_URL is not configured.');
    }

    const call = await twilioClient.calls.create({
      url: `${publicUrl}/voice/outbound/twiml?callerId=${encodeURIComponent(client.phone)}`,
      to: client.phone,
      from: config.twilio.phoneNumber,
      statusCallback: `${publicUrl}/voice/status`,
      statusCallbackMethod: 'POST',
      // Do not restrict statusCallbackEvent to ensure we get terminal states
    });

    activeCallSid = call.sid;
    logger.info(`Smart Drip: Initiated call to ${client.phone}. CallSid: ${call.sid}`);

    // Mark as called ONLY after successful initiation
    clients[nextClientIndex].status = 'CALLED';
    fs.writeFileSync(clientsPath, JSON.stringify(clients, null, 2));

  } catch (error) {
    logger.error('Smart Drip: Error initiating call', error);
    // Release lock on failure
    isCallActive = false;
    activeCallSid = null;
  }
};

export const startDrip = () => {
  logger.info('Starting Smart Drip Campaign polling...');
  // Poll every 10 seconds
  dripInterval = setInterval(processNextCall, 10000);
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Smart Drip Campaign stopped.');
  }
};

export const markCallEnded = (callSid) => {
  if (activeCallSid === callSid) {
    logger.info(`Smart Drip: Releasing lock for call ${callSid}`);
    isCallActive = false;
    activeCallSid = null;
  }
};
