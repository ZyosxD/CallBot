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

const CLIENTS_FILE = path.join(process.cwd(), 'src', 'data', 'clients.json');

const getClients = () => {
  try {
    return JSON.parse(fs.readFileSync(CLIENTS_FILE, 'utf8'));
  } catch (error) {
    logger.error('Error reading clients.json:', error);
    return [];
  }
};

const saveClients = (clients) => {
  try {
    fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));
  } catch (error) {
    logger.error('Error writing clients.json:', error);
  }
};

const isWithinOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const morningStart = now.hour(9).minute(30).second(0);
  const morningEnd = now.hour(11).minute(30).second(0);
  const afternoonStart = now.hour(14).minute(30).second(0);
  const afternoonEnd = now.hour(15).minute(30).second(0);

  return now.isBetween(morningStart, morningEnd) || now.isBetween(afternoonStart, afternoonEnd);
};

export const startDrip = () => {
  if (dripInterval) return;

  logger.info('Starting Smart Drip service');

  dripInterval = setInterval(async () => {
    if (isCallActive) return;

    if (!isWithinOperatingHours()) {
      return; // Wait for operating hours, don't stop the loop
    }

    const clients = getClients();
    const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (nextClientIndex === -1) {
      return; // No pending clients, keep waiting
    }

    const client = clients[nextClientIndex];

    // Mark as CALLED immediately before dialing to prevent duplicates
    clients[nextClientIndex].status = 'CALLED';
    saveClients(clients);

    isCallActive = true;

    try {
      logger.info(`Dialing ${client.phone} (${client.name})`);
      const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

      const call = await twilioClient.calls.create({
        to: client.phone,
        from: config.twilio.phoneNumber,
        url: `${config.server.publicUrl}/voice/outbound?callerId=${encodeURIComponent(client.phone)}`,
        statusCallback: `${config.server.publicUrl}/voice/status`,
        // No statusCallbackEvent restrictions to catch all terminal states
      });

      activeCallSid = call.sid;
      logger.info(`Outbound call initiated with SID: ${activeCallSid}`);
    } catch (error) {
      logger.error(`Error dialing ${client.phone}:`, error);
      isCallActive = false; // Release lock on error
      activeCallSid = null;
    }

  }, 10000); // Check every 10 seconds
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Smart Drip service stopped');
  }
};

export const markCallEnded = (callSid) => {
  if (activeCallSid === callSid) {
    logger.info(`Releasing lock for CallSid: ${callSid}`);
    isCallActive = false;
    activeCallSid = null;
  }
};
