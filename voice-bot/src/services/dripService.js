import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import twilio from 'twilio';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import isBetween from 'dayjs/plugin/isBetween.js';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isBetween);
dayjs.extend(customParseFormat);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientsFilePath = path.join(__dirname, '../data/clients.json');

let dripInterval = null;
let isCallActive = false;
export let activeCallSid = null;

const checkTimeWindow = () => {
  const now = dayjs().tz('America/Denver');
  const morningStart = now.hour(9).minute(30).second(0);
  const morningEnd = now.hour(11).minute(30).second(0);
  const afternoonStart = now.hour(14).minute(30).second(0);
  const afternoonEnd = now.hour(15).minute(30).second(0);

  return now.isBetween(morningStart, morningEnd) || now.isBetween(afternoonStart, afternoonEnd);
};

const readClients = () => {
  try {
    const data = fs.readFileSync(clientsFilePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    logger.error('Error reading clients.json:', error);
    return [];
  }
};

const writeClients = (clients) => {
  try {
    fs.writeFileSync(clientsFilePath, JSON.stringify(clients, null, 2));
  } catch (error) {
    logger.error('Error writing to clients.json:', error);
  }
};

export const startDrip = () => {
  if (dripInterval) return;
  logger.info('Starting Smart Drip Campaign...');

  dripInterval = setInterval(async () => {
    if (isCallActive) return; // Wait for the active call to finish
    if (!checkTimeWindow()) return; // Outside operating hours

    const clients = readClients();
    const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (nextClientIndex === -1) {
      return; // No pending clients, wait
    }

    const client = clients[nextClientIndex];
    isCallActive = true; // Lock

    try {
      const clientName = client.name || 'Client';
      const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

      const twimlUrl = new URL(`${config.server.publicUrl}/voice/outbound`);
      twimlUrl.searchParams.append('callerId', client.phone); // Pass phone as callerId

      const call = await twilioClient.calls.create({
        to: client.phone,
        from: config.twilio.phoneNumber,
        url: twimlUrl.toString(),
        statusCallback: `${config.server.publicUrl}/voice/inbound/status`,
      });

      activeCallSid = call.sid;

      // Update status immediately
      clients[nextClientIndex].status = 'CALLED';
      writeClients(clients);

      logger.info(`Outbound call initiated to ${client.phone}. SID: ${call.sid}`);
    } catch (error) {
      logger.error(`Error initiating call to ${client.phone}:`, error);
      isCallActive = false; // Release lock on error
      activeCallSid = null;
    }
  }, 10000); // Check every 10 seconds
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Smart Drip Campaign stopped.');
  }
};

export const markCallEnded = (callSid) => {
  if (activeCallSid === callSid || activeCallSid === null) {
    logger.info(`Releasing lock for call SID: ${callSid}`);
    isCallActive = false;
    activeCallSid = null;
  }
};
