import fs from 'fs';
import path from 'path';
import twilio from 'twilio';
import { fileURLToPath } from 'url';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientsFilePath = path.join(__dirname, '../data/clients.json');

let intervalId = null;
let isCallActive = false;
export let activeCallSid = null;

const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

export const isWithinOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const hour = now.hour();
  const minute = now.minute();
  const timeInMinutes = hour * 60 + minute;

  const morningStart = 9 * 60 + 30; // 9:30 AM
  const morningEnd = 11 * 60 + 30; // 11:30 AM

  const afternoonStart = 14 * 60 + 30; // 2:30 PM
  const afternoonEnd = 15 * 60 + 30; // 3:30 PM

  return (timeInMinutes >= morningStart && timeInMinutes <= morningEnd) ||
         (timeInMinutes >= afternoonStart && timeInMinutes <= afternoonEnd);
};

export const processNextClient = async () => {
  if (isCallActive) {
    logger.info('A call is already active. Waiting.');
    return;
  }

  if (!isWithinOperatingHours()) {
    logger.info('Outside operating hours in America/Denver. Waiting.');
    return; // Returns and waits, keeping cron-like polling alive
  }

  let clients = [];
  try {
    const data = fs.readFileSync(clientsFilePath, 'utf8');
    clients = JSON.parse(data);
  } catch (error) {
    logger.error('Error reading clients file:', error);
    return;
  }

  const clientIndex = clients.findIndex(c => c.status === 'PENDING');

  if (clientIndex === -1) {
    logger.info('No pending clients found in Smart Drip.');
    return; // Returns and waits
  }

  const client = clients[clientIndex];
  isCallActive = true;

  try {
    const callUrl = `${config.server.publicUrl}/voice/inbound?mode=outbound&callerId=${encodeURIComponent(client.phone)}`;

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${config.server.publicUrl.replace(/^https?:\/\//, '')}/voice/stream">
      <Parameter name="mode" value="outbound"/>
      <Parameter name="callerId" value="${client.phone}"/>
    </Stream>
  </Connect>
</Response>`;

    const call = await twilioClient.calls.create({
      twiml: twiml,
      to: client.phone,
      from: config.twilio.phoneNumber,
      statusCallback: `${config.server.publicUrl}/voice/status`,
    });

    activeCallSid = call.sid;
    logger.info(`Initiated Smart Drip outbound call ${call.sid} to ${client.phone}`);

    // Mark as CALLED immediately after successfully initiating the call
    clients[clientIndex].status = 'CALLED';
    fs.writeFileSync(clientsFilePath, JSON.stringify(clients, null, 2));

  } catch (error) {
    logger.error('Error initiating outbound call:', error);
    isCallActive = false; // Reset lock if initiation fails
  }
};

export const startDrip = () => {
  if (intervalId) return;
  logger.info('Smart Drip engine started (Polling every 10 seconds).');
  intervalId = setInterval(processNextClient, 10000); // Check every 10s
};

export const stopDrip = () => {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info('Smart Drip engine stopped.');
  }
};

export const markCallEnded = (callSid) => {
  if (callSid === activeCallSid) {
    logger.info(`Releasing concurrency lock for call ${callSid}`);
    isCallActive = false;
    activeCallSid = null;
  }
};
