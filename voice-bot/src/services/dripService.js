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
const CLIENTS_FILE = path.join(__dirname, '../data/clients.json');

let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

export const isWithinOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const h = now.hour();
  const m = now.minute();
  const time = h + m / 60;

  const morningStart = 9.5; // 9:30 AM
  const morningEnd = 11.5;  // 11:30 AM
  const afternoonStart = 14.5; // 2:30 PM
  const afternoonEnd = 15.5;   // 3:30 PM

  return (time >= morningStart && time < morningEnd) || (time >= afternoonStart && time < afternoonEnd);
};

export const startDrip = () => {
  if (dripInterval) return;

  if (!config.server.publicUrl) {
    logger.warn('PUBLIC_URL is not set. Drip Service will not start.');
    return;
  }

  logger.info('Starting Smart Drip Service');
  dripInterval = setInterval(processNextCall, 15000); // Check every 15s
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Stopped Smart Drip Service');
  }
};

export const markCallEnded = (callSid) => {
  if (activeCallSid === callSid) {
    logger.info(`Call ${callSid} ended, releasing lock.`);
    isCallActive = false;
    activeCallSid = null;
  }
};

export const processNextCall = async () => {
  if (isCallActive) return;

  if (!isWithinOperatingHours()) {
    // If we're outside operating hours but a call is active,
    // we would handle termination, but since isCallActive is false here,
    // we just don't initiate a new one.
    return;
  }

  let clients = [];
  try {
    const data = fs.readFileSync(CLIENTS_FILE, 'utf-8');
    clients = JSON.parse(data);
  } catch (error) {
    logger.error('Error reading clients.json:', error);
    return;
  }

  const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');
  if (nextClientIndex === -1) {
    logger.info('No more pending clients in the queue.');
    return;
  }

  const client = clients[nextClientIndex];

  logger.info(`Initiating outbound call to ${client.name} (${client.phone})`);
  isCallActive = true;
  clients[nextClientIndex].status = 'CALLED';

  try {
    fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));

    const twiml = `<Response>
      <Connect>
        <Stream url="wss://${config.server.publicUrl.replace('https://', '')}/voice/stream">
          <Parameter name="mode" value="outbound" />
          <Parameter name="callerId" value="${client.phone}" />
        </Stream>
      </Connect>
    </Response>`;

    const call = await twilioClient.calls.create({
      twiml: twiml,
      to: client.phone,
      from: config.twilio.phoneNumber,
      statusCallback: `${config.server.publicUrl}/voice/status-callback`,
      statusCallbackEvent: ['completed'],
      statusCallbackMethod: 'POST'
    });

    activeCallSid = call.sid;
    logger.info(`Call started: ${call.sid}`);
  } catch (error) {
    logger.error(`Failed to call ${client.phone}:`, error);
    isCallActive = false;
    activeCallSid = null;

    // Revert status on failure
    clients[nextClientIndex].status = 'PENDING';
    fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));
  }
};
