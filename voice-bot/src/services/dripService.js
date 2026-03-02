import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CLIENTS_FILE = path.join(__dirname, '../data/clients.json');
let isCallActive = false;
let dripInterval = null;

const isWithinOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const hour = now.hour();
  const minute = now.minute();

  const isMorning = (hour === 9 && minute >= 30) || hour === 10 || (hour === 11 && minute <= 30);
  const isAfternoon = (hour === 14 && minute >= 30) || (hour === 15 && minute <= 30);

  return isMorning || isAfternoon;
};

const readClients = () => {
  try {
    const data = fs.readFileSync(CLIENTS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    logger.error('Error reading clients file:', error);
    return [];
  }
};

const writeClients = (clients) => {
  try {
    fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2), 'utf8');
  } catch (error) {
    logger.error('Error writing clients file:', error);
  }
};

const executeCall = async (client) => {
  isCallActive = true;
  logger.info(`Starting outbound call to ${client.name} at ${client.phone}`);

  try {
    const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
    const host = config.server.publicUrl.replace(/^https?:\/\//, '');

    const twiml = `
      <Response>
        <Connect>
          <Stream url="wss://${host}/voice/stream">
            <Parameter name="callerId" value="${client.phone}" />
            <Parameter name="mode" value="outbound" />
          </Stream>
        </Connect>
      </Response>
    `;

    const call = await twilioClient.calls.create({
      twiml: twiml,
      to: client.phone,
      from: config.twilio.phoneNumber,
      statusCallback: `${config.server.publicUrl}/voice/status-callback`,
      statusCallbackEvent: ['completed'],
      statusCallbackMethod: 'POST',
    });

    logger.info(`Call initiated. SID: ${call.sid}`);

  } catch (error) {
    logger.error('Error initiating outbound call:', error);
    isCallActive = false; // Release lock if it fails immediately
  }
};

const processNextClient = async () => {
  if (isCallActive) {
    logger.info('A call is currently active. Waiting...');
    return;
  }

  if (!isWithinOperatingHours()) {
    logger.info('Outside of operating hours (Denver Time). Waiting...');
    return;
  }

  const clients = readClients();
  const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

  if (nextClientIndex !== -1) {
    const nextClient = clients[nextClientIndex];

    // Mark as called immediately to prevent duplicates
    clients[nextClientIndex].status = 'CALLED';
    writeClients(clients);

    await executeCall(nextClient);
  } else {
    logger.info('No pending clients found in the list.');
  }
};

export const startDrip = () => {
  if (dripInterval) {
    logger.info('Drip service is already running.');
    return;
  }

  logger.info('Starting Smart Drip Service...');
  // Check every 30 seconds
  dripInterval = setInterval(processNextClient, 30000);

  // Also run immediately
  processNextClient();
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Smart Drip Service stopped.');
  }
};

export const callEnded = () => {
  logger.info('Call ended. Releasing concurrency lock.');
  isCallActive = false;
};
