import fs from 'fs';
import path from 'path';
import twilio from 'twilio';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const clientsPath = path.join(process.cwd(), 'src/data/clients.json');

let dripInterval = null;
let isCallActive = false;
let activeCallSid = null;

const isWithinOperatingHours = () => {
  const denverTime = dayjs().tz('America/Denver');
  const hour = denverTime.hour();
  const minute = denverTime.minute();
  const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;

  const isMorning = timeStr >= '09:30' && timeStr < '11:30';
  const isAfternoon = timeStr >= '14:30' && timeStr < '15:30';

  return isMorning || isAfternoon;
};

const readClients = () => {
  if (!fs.existsSync(clientsPath)) return [];
  const data = fs.readFileSync(clientsPath, 'utf8');
  return JSON.parse(data);
};

const saveClients = (clients) => {
  fs.writeFileSync(clientsPath, JSON.stringify(clients, null, 2));
};

const executeDrip = async () => {
  if (isCallActive) {
    return;
  }

  if (!isWithinOperatingHours()) {
    logger.info('Smart Drip: Outside operating hours, waiting...');
    return;
  }

  const clients = readClients();
  const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

  if (nextClientIndex === -1) {
    logger.info('Smart Drip: No PENDING clients found, waiting...');
    return;
  }

  const client = clients[nextClientIndex];

  // Mark as CALLED before making the call
  clients[nextClientIndex].status = 'CALLED';
  saveClients(clients);

  try {
    logger.info(`Smart Drip: Initiating call to ${client.phone}`);
    const clientTwilio = twilio(config.twilio.accountSid, config.twilio.authToken);

    isCallActive = true;
    const call = await clientTwilio.calls.create({
      to: client.phone,
      from: config.twilio.phoneNumber,
      // Pass callerId via query params
      url: `${config.server.publicUrl}/voice/inbound?callerId=${encodeURIComponent(client.phone)}`,
      statusCallback: `${config.server.publicUrl}/voice/inbound/status`,
    });

    activeCallSid = call.sid;
    logger.info(`Smart Drip: Call started with SID ${call.sid}`);

  } catch (error) {
    logger.error('Smart Drip: Error executing call:', error);
    isCallActive = false;
    activeCallSid = null;
  }
};

export const markCallEnded = (callSid) => {
  if (callSid === activeCallSid) {
    logger.info(`Smart Drip: Call ended, releasing lock for ${callSid}`);
    isCallActive = false;
    activeCallSid = null;
  }
};

export const startDrip = () => {
  if (dripInterval) return;
  logger.info('Smart Drip Engine Started');
  // Poll every 30 seconds
  dripInterval = setInterval(executeDrip, 30000);
  executeDrip();
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Smart Drip Engine Stopped');
  }
};
