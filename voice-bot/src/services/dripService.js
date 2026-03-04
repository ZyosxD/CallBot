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

const loadClients = () => {
  try {
    const data = fs.readFileSync(clientsFilePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    logger.error('Error loading clients.json', error);
    return [];
  }
};

const saveClients = (clients) => {
  try {
    fs.writeFileSync(clientsFilePath, JSON.stringify(clients, null, 2), 'utf-8');
  } catch (error) {
    logger.error('Error saving clients.json', error);
  }
};

const isWithinOperatingHours = () => {
  const nowInDenver = dayjs().tz('America/Denver');
  const timeStr = nowInDenver.format('HH:mm');
  const timeVal = parseFloat(timeStr.replace(':', '.'));

  const morningStart = 9.30;
  const morningEnd = 11.30;
  const afternoonStart = 14.30;
  const afternoonEnd = 15.30;

  return (timeVal >= morningStart && timeVal < morningEnd) || (timeVal >= afternoonStart && timeVal < afternoonEnd);
};

export const initiateCall = async (client) => {
  if (isCallActive) return;
  isCallActive = true;

  try {
    logger.info(`Initiating call to ${client.name} at ${client.phone}`);

    const clientRest = twilio(config.twilio.accountSid, config.twilio.authToken);

    const publicUrl = config.server.publicUrl.replace('https://', 'wss://').replace('http://', 'ws://');

    // Inline TwiML generation to avoid dependencies on external endpoints
    const twiml = `
      <Response>
        <Connect>
          <Stream url="${publicUrl}/voice/stream">
            <Parameter name="callerId" value="${client.phone}" />
            <Parameter name="mode" value="outbound" />
          </Stream>
        </Connect>
      </Response>
    `;

    await clientRest.calls.create({
      twiml: twiml,
      to: client.phone,
      from: config.twilio.phoneNumber,
      statusCallback: `${config.server.publicUrl}/voice/status-callback`,
      statusCallbackEvent: ['completed', 'failed', 'busy', 'no-answer', 'canceled']
    });

    logger.info(`Call placed to ${client.phone}`);
  } catch (error) {
    logger.error(`Error placing call to ${client.phone}:`, error);
    isCallActive = false; // release lock on failure to place call
  }
};

export const checkAndCall = () => {
  if (isCallActive) return;

  if (!isWithinOperatingHours()) {
    logger.info('Outside of operating hours (Denver Time). Waiting...');
    return;
  }

  const clients = loadClients();
  const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

  if (nextClientIndex === -1) {
    logger.info('No pending clients to call.');
    return;
  }

  const nextClient = clients[nextClientIndex];
  clients[nextClientIndex].status = 'CALLED';
  saveClients(clients);

  initiateCall(nextClient);
};

export const startDrip = () => {
  if (!config.server.publicUrl) {
    logger.warn('Server public URL not set. Drip service will not start.');
    return;
  }
  logger.info('Starting Smart Drip service...');
  checkAndCall();
  // Check every 30 seconds
  dripInterval = setInterval(checkAndCall, 30000);
};

export const stopDrip = () => {
  logger.info('Stopping Smart Drip service...');
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
  }
};

export const handleCallEnded = () => {
  logger.info('Call ended. Releasing concurrency lock.');
  isCallActive = false;
};
