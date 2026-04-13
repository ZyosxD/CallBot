import fs from 'fs';
import path from 'path';
import twilio from 'twilio';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';
import { fileURLToPath } from 'url';

dayjs.extend(utc);
dayjs.extend(timezone);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientsPath = path.join(__dirname, '../data/clients.json');

let twilioClient;
if (config.twilio.accountSid && config.twilio.authToken) {
  twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
}

let dripInterval = null;
let isCallActive = false;
export let activeCallSid = null;

const isWithinOperatingHours = () => {
  const denverTime = dayjs().tz('America/Denver');
  const timeStr = denverTime.format('HH:mm');
  const isMorning = timeStr >= '09:30' && timeStr <= '11:30';
  const isAfternoon = timeStr >= '14:30' && timeStr <= '15:30';
  return isMorning || isAfternoon;
};

const readClients = () => {
  try {
    const data = fs.readFileSync(clientsPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    logger.error('Error reading clients.json:', error);
    return [];
  }
};

const writeClients = (clients) => {
  try {
    fs.writeFileSync(clientsPath, JSON.stringify(clients, null, 2), 'utf8');
  } catch (error) {
    logger.error('Error writing clients.json:', error);
  }
};

export const startDrip = () => {
  if (dripInterval) return;
  logger.info('Starting Smart Drip Engine...');

  dripInterval = setInterval(async () => {
    if (isCallActive) return;
    if (!isWithinOperatingHours()) return;

    const clients = readClients();
    const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (nextClientIndex === -1) {
      return; // No pending clients, just wait
    }

    const client = clients[nextClientIndex];
    isCallActive = true;
    clients[nextClientIndex].status = 'CALLED';
    writeClients(clients);

    try {
      logger.info(`Initiating outbound call to ${client.phone}`);

      const twimlUrl = new URL('/voice/outbound', config.server.publicUrl || 'http://localhost:3000');
      twimlUrl.searchParams.append('callerId', client.phone);

      const call = await twilioClient.calls.create({
        to: client.phone,
        from: config.twilio.phoneNumber,
        url: twimlUrl.toString(),
        statusCallback: `${config.server.publicUrl || 'http://localhost:3000'}/voice/inbound/status`,
        statusCallbackMethod: 'POST',
      });

      activeCallSid = call.sid;
      logger.info(`Call initiated. CallSid: ${activeCallSid}`);
    } catch (error) {
      logger.error('Error initiating call:', error);
      isCallActive = false;
      activeCallSid = null;
    }

  }, 10000); // Check every 10 seconds
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Smart Drip Engine stopped.');
  }
};

export const markCallEnded = (callSid) => {
  if (callSid === activeCallSid) {
    isCallActive = false;
    activeCallSid = null;
    logger.info(`Call ${callSid} ended. Released Smart Drip lock.`);
  }
};
