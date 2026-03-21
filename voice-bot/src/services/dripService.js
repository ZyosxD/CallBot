import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import twilio from 'twilio';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientsFilePath = path.join(__dirname, '../data/clients.json');

let dripInterval = null;
export let isCallActive = false;
export let activeCallSid = null;

const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

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
    fs.writeFileSync(clientsFilePath, JSON.stringify(clients, null, 2), 'utf8');
  } catch (error) {
    logger.error('Error writing clients.json:', error);
  }
};

const isWithinOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const hour = now.hour();
  const minute = now.minute();
  const timeInMinutes = hour * 60 + minute;

  // 9:30 AM (570) to 11:30 AM (690)
  const morningStart = 9 * 60 + 30;
  const morningEnd = 11 * 60 + 30;

  // 2:30 PM (860) to 3:30 PM (930)
  const afternoonStart = 14 * 60 + 30;
  const afternoonEnd = 15 * 60 + 30;

  if (
    (timeInMinutes >= morningStart && timeInMinutes <= morningEnd) ||
    (timeInMinutes >= afternoonStart && timeInMinutes <= afternoonEnd)
  ) {
    return true;
  }
  return false;
};

const initiateNextCall = async () => {
  if (isCallActive) {
    logger.info('Call is currently active. Waiting...');
    return;
  }

  if (!isWithinOperatingHours()) {
    logger.info('Outside operating hours. Drip engine waiting...');
    return;
  }

  const clients = readClients();
  const nextClientIndex = clients.findIndex(client => client.status === 'PENDING');

  if (nextClientIndex === -1) {
    logger.info('No PENDING clients left. Drip engine waiting...');
    return;
  }

  const client = clients[nextClientIndex];
  logger.info(`Initiating call to ${client.name} at ${client.phone}`);

  // Mark immediately as CALLED to prevent duplicates
  clients[nextClientIndex].status = 'CALLED';
  writeClients(clients);

  isCallActive = true;
  activeCallSid = null;

  try {
    const baseUrl = config.server.publicUrl;
    // TwiML for outbound call connecting to websocket
    const twiml = `
      <Response>
        <Connect>
          <Stream url="wss://${baseUrl.replace(/^https?:\/\//, '')}/voice/stream">
            <Parameter name="mode" value="outbound" />
            <Parameter name="callerId" value="${client.phone}" />
          </Stream>
        </Connect>
      </Response>
    `;

    const call = await twilioClient.calls.create({
      twiml: twiml,
      to: client.phone,
      from: config.twilio.phoneNumber,
      statusCallback: `${baseUrl}/voice/status-callback`,
      statusCallbackMethod: 'POST',
      timeout: 30
    });

    activeCallSid = call.sid;
    logger.info(`Outbound call initiated with SID: ${call.sid}`);

  } catch (error) {
    logger.error('Error initiating Twilio call:', error);
    // On failure, release lock and potentially unmark client (optional, but requested to strictly mark after initiate)
    isCallActive = false;
    activeCallSid = null;
  }
};

export const markCallEnded = (sid) => {
  if (activeCallSid === sid) {
    logger.info(`Call ended callback received for ${sid}. Releasing lock.`);
    isCallActive = false;
    activeCallSid = null;
  } else {
    logger.info(`Call ended for ${sid}, but it doesn't match activeCallSid ${activeCallSid}`);
  }
};

export const startDrip = () => {
  if (dripInterval) {
    logger.info('Drip engine already running.');
    return;
  }
  logger.info('Starting Smart Drip Engine...');

  // Check every 30 seconds
  dripInterval = setInterval(() => {
    initiateNextCall();
  }, 30000);

  // Trigger first immediately
  initiateNextCall();
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Smart Drip Engine stopped.');
  }
};
