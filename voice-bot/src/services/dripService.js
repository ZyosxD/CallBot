import fs from 'fs';
import path from 'path';
import twilio from 'twilio';
import { fileURLToPath } from 'url';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientsPath = path.join(__dirname, '../data/clients.json');

let dripInterval = null;
let isCallActive = false;
let activeCallSid = null;

const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

const isWithinOperatingHours = () => {
  const denverTime = dayjs().tz('America/Denver');
  const hour = denverTime.hour();
  const minute = denverTime.minute();
  const time = hour * 100 + minute;

  // 9:30 AM to 11:30 AM -> 0930 to 1130
  const isMorning = time >= 930 && time < 1130;
  // 2:30 PM to 3:30 PM -> 1430 to 1530
  const isAfternoon = time >= 1430 && time < 1530;

  return isMorning || isAfternoon;
};

const processNextCall = async () => {
  if (!isWithinOperatingHours()) {
    logger.info('Outside operating hours for Smart Drip. Waiting...');
    return;
  }

  if (isCallActive) {
    logger.info('Call is currently active. Waiting...');
    return;
  }

  let clients = [];
  try {
    const data = fs.readFileSync(clientsPath, 'utf8');
    clients = JSON.parse(data);
  } catch (err) {
    logger.error('Error reading clients.json:', err);
    return;
  }

  const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

  if (nextClientIndex === -1) {
    logger.info('No pending clients to call in Smart Drip.');
    return;
  }

  const client = clients[nextClientIndex];

  isCallActive = true;
  clients[nextClientIndex].status = 'CALLED';

  try {
    fs.writeFileSync(clientsPath, JSON.stringify(clients, null, 2));
  } catch (err) {
    logger.error('Error writing to clients.json:', err);
    isCallActive = false;
    return;
  }

  logger.info(`Initiating outbound call to ${client.phone}...`);

  try {
    const publicUrl = config.server.publicUrl;
    // We pass callerId to dynamically inject it into the stream later
    const twimlUrl = `${publicUrl}/voice/outbound?callerId=${encodeURIComponent(client.phone)}`;

    const call = await twilioClient.calls.create({
      url: twimlUrl,
      to: client.phone,
      from: config.twilio.phoneNumber,
      statusCallback: `${publicUrl}/voice/status`,
    });

    activeCallSid = call.sid;
    logger.info(`Call initiated. SID: ${activeCallSid}`);
  } catch (err) {
    logger.error('Error initiating Twilio call:', err);
    isCallActive = false;
    activeCallSid = null;
  }
};

export const startDrip = () => {
  if (dripInterval) return;
  logger.info('Starting Smart Drip Engine...');
  // Check every 15 seconds
  dripInterval = setInterval(processNextCall, 15000);
  processNextCall();
};

export const stopDrip = () => {
  if (dripInterval) {
    logger.info('Stopping Smart Drip Engine...');
    clearInterval(dripInterval);
    dripInterval = null;
  }
};

export const markCallEnded = (callSid) => {
  if (callSid === activeCallSid) {
    logger.info(`Active call ${callSid} ended. Releasing lock.`);
    isCallActive = false;
    activeCallSid = null;
  }
};
