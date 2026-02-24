import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import twilio from 'twilio';
import { config } from '../config/config.js';

dayjs.extend(utc);
dayjs.extend(timezone);
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLIENTS_FILE = path.join(__dirname, '../data/clients.json');

let isCallActive = false;
let currentCallSid = null;
let dripInterval = null;

const client = twilio(config.twilio.accountSid, config.twilio.authToken);

export const startDrip = () => {
  logger.info('Starting Smart Drip Service...');
  if (dripInterval) clearInterval(dripInterval);
  dripInterval = setInterval(checkAndCall, 60000); // Check every minute
  checkAndCall(); // Run immediately on start
};

export const stopDrip = () => {
  if (dripInterval) clearInterval(dripInterval);
  logger.info('Stopping Smart Drip Service...');
};

const isOperatingHours = () => {
  const now = dayjs().tz("America/Denver");
  const hour = now.hour();
  const minute = now.minute();

  // 9:30 - 11:30
  const isMorning = (hour === 9 && minute >= 30) || (hour === 10) || (hour === 11 && minute < 30);

  // 14:30 - 15:30 (2:30 PM - 3:30 PM)
  const isAfternoon = (hour === 14 && minute >= 30) || (hour === 15 && minute < 30);

  return isMorning || isAfternoon;
};

const checkAndCall = async () => {
  // Check if we need to terminate an existing call because hours are over
  if (isCallActive && currentCallSid && !isOperatingHours()) {
    logger.info('Operating hours ended. Terminating active call...');
    try {
      await client.calls(currentCallSid).update({ status: 'completed' });
    } catch (e) {
      logger.error('Error terminating call:', e);
    }
    // handleCallEnded will be called by status callback
    return;
  }

  if (isCallActive) {
    logger.info('Call currently active. Waiting...');
    return;
  }

  if (!isOperatingHours()) {
    logger.info('Outside operating hours. Waiting...');
    return;
  }

  try {
    const data = await fs.readFile(CLIENTS_FILE, 'utf8');
    const clients = JSON.parse(data);
    const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (nextClientIndex === -1) {
      logger.info('No pending clients found.');
      return;
    }

    const nextClient = clients[nextClientIndex];
    logger.info(`Initiating call for client: ${nextClient.name} (${nextClient.phone})`);

    // Mark as CALLED immediately
    clients[nextClientIndex].status = 'CALLED';
    await fs.writeFile(CLIENTS_FILE, JSON.stringify(clients, null, 2));

    isCallActive = true;
    await makeCall(nextClient);

  } catch (error) {
    logger.error('Error in drip loop:', error);
    isCallActive = false; // Reset on error
  }
};

const makeCall = async (targetClient) => {
  try {
    const callbackUrl = `${config.server.publicUrl}/voice/status-callback`;
    // Ensure publicUrl doesn't have protocol for websocket
    const host = config.server.publicUrl.replace('https://', '').replace('http://', '');
    const streamUrl = `wss://${host}/voice/stream`;

    // Construct TwiML
    const twiml = `
<Response>
  <Connect>
    <Stream url="${streamUrl}">
      <Parameter name="callerId" value="${targetClient.phone}" />
      <Parameter name="clientName" value="${targetClient.name}" />
    </Stream>
  </Connect>
</Response>
    `;

    const call = await client.calls.create({
      to: targetClient.phone,
      from: config.twilio.phoneNumber,
      twiml: twiml,
      statusCallback: callbackUrl,
      statusCallbackEvent: ['completed', 'busy', 'no-answer', 'failed', 'canceled']
    });

    currentCallSid = call.sid;
    logger.info(`Call initiated to ${targetClient.phone}, SID: ${call.sid}`);
  } catch (error) {
    logger.error(`Failed to initiate call to ${targetClient.phone}:`, error);
    isCallActive = false;
    currentCallSid = null;
  }
};

export const handleCallEnded = () => {
  logger.info('Call ended event received. Releasing lock.');
  isCallActive = false;
  currentCallSid = null;
};
