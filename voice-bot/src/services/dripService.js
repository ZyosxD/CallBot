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

let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const clientsPath = path.resolve('src/data/clients.json');

const getClients = () => {
  if (!fs.existsSync(clientsPath)) return [];
  const data = fs.readFileSync(clientsPath, 'utf-8');
  return JSON.parse(data);
};

const saveClients = (clients) => {
  fs.writeFileSync(clientsPath, JSON.stringify(clients, null, 2), 'utf-8');
};

const isWithinOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const time = now.format('HH:mm');

  const morningStart = '09:30';
  const morningEnd = '11:30';
  const afternoonStart = '14:30';
  const afternoonEnd = '15:30';

  if (time >= morningStart && time <= morningEnd) return true;
  if (time >= afternoonStart && time <= afternoonEnd) return true;
  return false;
};

export const startDrip = () => {
  logger.info('Smart Drip Service started.');
  dripInterval = setInterval(async () => {
    if (isCallActive) return;

    if (!isWithinOperatingHours()) {
      // Just wait until operating hours
      return;
    }

    const clients = getClients();
    const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (nextClientIndex === -1) {
      // No clients pending, wait for new ones
      return;
    }

    // Found a client, lock
    isCallActive = true;
    const client = clients[nextClientIndex];
    client.status = 'CALLED';
    saveClients(clients);

    try {
      logger.info(`Dialing ${client.phone} (Smart Drip)`);
      const clientTwilio = twilio(config.twilio.accountSid, config.twilio.authToken);

      const host = config.server.publicUrl;
      const twimlUrl = `${host}/voice/inbound?mode=outbound&callerId=${encodeURIComponent(client.phone)}`;
      const statusCallback = `${host}/voice/inbound/status`;

      const call = await clientTwilio.calls.create({
        to: client.phone,
        from: config.twilio.phoneNumber,
        url: twimlUrl,
        statusCallback: statusCallback
      });

      activeCallSid = call.sid;

    } catch (error) {
      logger.error('Error initiating outbound call:', error);
      // Unlock on error
      isCallActive = false;
      activeCallSid = null;
    }

  }, 10000); // Check every 10 seconds
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
  }
  logger.info('Smart Drip Service stopped.');
};

export const markCallEnded = (callSid) => {
  if (callSid === activeCallSid) {
    isCallActive = false;
    activeCallSid = null;
    logger.info(`Call ended for ${callSid}, lock released.`);
  }
};
