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
let dripInterval = null;

const checkOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const timeStr = now.format('HH:mm');

  const isMorning = timeStr >= '09:30' && timeStr <= '11:30';
  const isAfternoon = timeStr >= '14:30' && timeStr <= '15:30';

  return isMorning || isAfternoon;
};

const readClients = () => {
  try {
    const data = fs.readFileSync(clientsFilePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    logger.error('Error reading clients.json:', error);
    return [];
  }
};

const updateClientStatus = (clientId, status) => {
  const clients = readClients();
  const updatedClients = clients.map(c => c.id == clientId ? { ...c, status } : c);
  try {
    fs.writeFileSync(clientsFilePath, JSON.stringify(updatedClients, null, 2), 'utf-8');
  } catch (error) {
    logger.error('Error writing to clients.json:', error);
  }
};

const executeNextCall = async () => {
  if (isCallActive) {
    logger.info('A call is currently active. Waiting...');
    return;
  }

  if (!checkOperatingHours()) {
    logger.info('Outside operating hours. Pausing Smart Drip.');
    return;
  }

  const clients = readClients();
  const nextClient = clients.find(c => c.status === 'PENDING');

  if (!nextClient) {
    logger.info('No pending clients found. Drip Service idle.');
    return;
  }

  // Mark immediately to prevent duplicates
  updateClientStatus(nextClient.id, 'CALLED');
  isCallActive = true;
  logger.info(`Starting outbound call to ${nextClient.name} (${nextClient.phone})`);

  try {
    const client = twilio(config.twilio.accountSid, config.twilio.authToken);
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${new URL(config.server.publicUrl).host}/voice/stream">
      <Parameter name="callerId" value="${nextClient.phone}" />
      <Parameter name="mode" value="outbound" />
    </Stream>
  </Connect>
</Response>`;

    await client.calls.create({
      twiml: twiml,
      to: nextClient.phone,
      from: config.twilio.phoneNumber,
      statusCallback: `${config.server.publicUrl}/voice/status-callback`,
      statusCallbackEvent: ['completed', 'failed', 'busy', 'no-answer', 'canceled']
    });

    logger.info(`Call initiated to ${nextClient.phone}`);
  } catch (error) {
    logger.error('Failed to initiate call:', error);
    isCallActive = false; // Reset on failure
  }
};

export const releaseCallLock = () => {
  logger.info('Call lock released. Ready for next call.');
  isCallActive = false;
};

export const startDrip = () => {
  if (dripInterval) {
    logger.warn('Drip service already running.');
    return;
  }
  logger.info('Starting Smart Drip Engine...');

  // Check every 30 seconds
  dripInterval = setInterval(executeNextCall, 30000);
  executeNextCall(); // Initial run
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Smart Drip Engine stopped.');
  }
};
