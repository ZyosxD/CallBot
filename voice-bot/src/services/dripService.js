import fs from 'fs';
import path from 'path';
import twilio from 'twilio';
import { fileURLToPath } from 'url';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientsPath = path.join(__dirname, '../data/clients.json');

let isCallActive = false;
let dripInterval = null;

const checkOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const hour = now.hour();
  const minute = now.minute();
  const currentTime = hour + minute / 60;

  const morningStart = 9.5; // 9:30 AM
  const morningEnd = 11.5;  // 11:30 AM
  const afternoonStart = 14.5; // 2:30 PM
  const afternoonEnd = 15.5;   // 3:30 PM

  const isMorning = currentTime >= morningStart && currentTime < morningEnd;
  const isAfternoon = currentTime >= afternoonStart && currentTime < afternoonEnd;

  return isMorning || isAfternoon;
};

const getPendingClient = () => {
  if (!fs.existsSync(clientsPath)) {
    logger.warn('clients.json not found');
    return null;
  }

  const data = fs.readFileSync(clientsPath, 'utf-8');
  let clients = [];
  try {
    clients = JSON.parse(data);
  } catch (err) {
    logger.error('Error parsing clients.json:', err);
    return null;
  }

  const clientIndex = clients.findIndex(c => c.status === 'PENDING');
  if (clientIndex !== -1) {
    const client = clients[clientIndex];
    clients[clientIndex].status = 'CALLED';
    fs.writeFileSync(clientsPath, JSON.stringify(clients, null, 2));
    return client;
  }
  return null;
};

const makeCall = async (client) => {
  if (!config.server.publicUrl) {
      logger.error('PUBLIC_URL is not set. Cannot make outbound call.');
      isCallActive = false;
      return;
  }

  const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

  const twiml = `
    <Response>
      <Connect>
        <Stream url="wss://${new URL(config.server.publicUrl).host}/voice/stream">
          <Parameter name="mode" value="outbound" />
          <Parameter name="callerId" value="${client.phone}" />
        </Stream>
      </Connect>
    </Response>
  `;

  try {
    logger.info(`Initiating outbound call to ${client.phone} (ID: ${client.id})`);
    await twilioClient.calls.create({
      twiml: twiml,
      to: client.phone,
      from: config.twilio.phoneNumber,
      statusCallback: `${config.server.publicUrl}/voice/status-callback`,
      statusCallbackEvent: ['completed', 'failed', 'busy', 'no-answer', 'canceled']
    });
  } catch (err) {
    logger.error(`Error making call to ${client.phone}:`, err);
    isCallActive = false;
  }
};

const checkAndDial = async () => {
  if (isCallActive) {
    return;
  }

  if (!checkOperatingHours()) {
    return;
  }

  const client = getPendingClient();
  if (client) {
    isCallActive = true;
    await makeCall(client);
  } else {
    logger.info('No pending clients found. Stopping drip service.');
    stopDrip();
  }
};

export const startDrip = () => {
  if (!config.server.publicUrl) {
    logger.warn('Drip service cannot start without PUBLIC_URL.');
    return;
  }
  if (!dripInterval) {
    logger.info('Starting Smart Drip service.');
    // Check every 30 seconds
    dripInterval = setInterval(checkAndDial, 30000);
    checkAndDial();
  }
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Smart Drip service stopped.');
  }
};

export const handleCallEnded = () => {
  logger.info('Call ended. Releasing lock.');
  isCallActive = false;
};
