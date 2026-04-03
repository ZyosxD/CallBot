import fs from 'fs';
import path from 'path';
import twilio from 'twilio';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const clientsFile = path.resolve('src/data/clients.json');

let dripInterval = null;
let isCallActive = false;
let activeCallSid = null;

const isWithinOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const time = now.format('HH:mm');

  const isMorning = time >= '09:30' && time <= '11:30';
  const isAfternoon = time >= '14:30' && time <= '15:30';

  return isMorning || isAfternoon;
};

const checkAndProcessNextCall = async () => {
  if (isCallActive) {
    return;
  }

  if (!isWithinOperatingHours()) {
    return;
  }

  let clients = [];
  try {
    const data = fs.readFileSync(clientsFile, 'utf8');
    clients = JSON.parse(data);
  } catch (err) {
    logger.error('Error reading clients.json:', err);
    return;
  }

  const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

  if (nextClientIndex === -1) {
    return;
  }

  const nextClient = clients[nextClientIndex];

  // Mark as CALLED immediately before executing call
  clients[nextClientIndex].status = 'CALLED';
  try {
    fs.writeFileSync(clientsFile, JSON.stringify(clients, null, 2));
  } catch (err) {
    logger.error('Error writing clients.json:', err);
    return;
  }

  isCallActive = true;
  logger.info(`Starting outbound call to ${nextClient.phone}`);

  try {
    const client = twilio(config.twilio.accountSid, config.twilio.authToken);
    const twimlUrl = `${config.server.publicUrl}/voice/outbound?callerId=${encodeURIComponent(nextClient.phone)}`;

    const call = await client.calls.create({
      to: nextClient.phone,
      from: config.twilio.phoneNumber,
      url: twimlUrl,
      statusCallback: `${config.server.publicUrl}/voice/inbound/status`
    });

    activeCallSid = call.sid;
    logger.info(`Call initiated. SID: ${activeCallSid}`);
  } catch (err) {
    logger.error(`Failed to initiate call to ${nextClient.phone}:`, err);
    // Release lock if API call fails
    isCallActive = false;
    activeCallSid = null;
  }
};

export const startDrip = () => {
  if (dripInterval) return;
  logger.info('Starting Smart Drip service...');
  dripInterval = setInterval(checkAndProcessNextCall, 15000);
  checkAndProcessNextCall();
};

export const stopDrip = () => {
  if (dripInterval) {
    logger.info('Stopping Smart Drip service...');
    clearInterval(dripInterval);
    dripInterval = null;
  }
};

export const markCallEnded = (callSid) => {
  if (callSid === activeCallSid) {
    logger.info(`Releasing lock for completed call ${callSid}`);
    isCallActive = false;
    activeCallSid = null;
  }
};
