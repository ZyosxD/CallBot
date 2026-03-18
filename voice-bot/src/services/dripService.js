import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientsPath = path.join(__dirname, '../data/clients.json');

let dripInterval = null;
let isCallActive = false;
export let activeCallSid = null;

const isWithinOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const hour = now.hour();
  const minute = now.minute();
  const timeInMinutes = hour * 60 + minute;

  const morningStart = 9 * 60 + 30; // 9:30 AM
  const morningEnd = 11 * 60 + 30;  // 11:30 AM
  const afternoonStart = 14 * 60 + 30; // 2:30 PM
  const afternoonEnd = 15 * 60 + 30;  // 3:30 PM

  return (
    (timeInMinutes >= morningStart && timeInMinutes <= morningEnd) ||
    (timeInMinutes >= afternoonStart && timeInMinutes <= afternoonEnd)
  );
};

export const startDrip = () => {
  if (dripInterval) return;
  logger.info('Starting Smart Drip Engine...');

  // Call execute immediately, then start interval
  executeDrip();
  dripInterval = setInterval(() => {
    executeDrip();
  }, 10000); // Check every 10 seconds
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
  }
};

const executeDrip = async () => {
  if (isCallActive) return; // Wait for active call to finish
  if (!isWithinOperatingHours()) return; // Outside hours

  let clients = [];
  try {
    const data = fs.readFileSync(clientsPath, 'utf8');
    clients = JSON.parse(data);
  } catch (error) {
    logger.error('Error reading clients.json:', error);
    return;
  }

  const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');
  if (nextClientIndex === -1) {
    // No more pending clients
    return;
  }

  const client = clients[nextClientIndex];

  // Mark as called BEFORE placing the call
  clients[nextClientIndex].status = 'CALLED';
  try {
    fs.writeFileSync(clientsPath, JSON.stringify(clients, null, 2));
  } catch (error) {
    logger.error('Error writing clients.json:', error);
    return;
  }

  logger.info(`Initiating outbound call to ${client.name} (${client.phone})`);

  isCallActive = true;

  try {
    const clientTwilio = twilio(config.twilio.accountSid, config.twilio.authToken);
    const twimlUrl = new URL('/voice/stream', config.server.publicUrl);
    twimlUrl.protocol = 'wss:';

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Connect>
          <Stream url="${twimlUrl.toString()}">
            <Parameter name="callerId" value="${client.phone}" />
            <Parameter name="mode" value="SARAH_OUTBOUND" />
          </Stream>
        </Connect>
      </Response>`;

    const call = await clientTwilio.calls.create({
      twiml: twiml,
      to: client.phone,
      from: config.twilio.phoneNumber,
      statusCallback: `${config.server.publicUrl}/voice/status-callback`,
      statusCallbackEvent: ['completed'],
      statusCallbackMethod: 'POST'
    });

    activeCallSid = call.sid;
    logger.info(`Call initiated. SID: ${call.sid}`);

  } catch (error) {
    logger.error('Error initiating Twilio call:', error);
    // Release lock if call failed to initiate
    isCallActive = false;
    activeCallSid = null;
  }
};

export const markCallEnded = (callSid) => {
  if (activeCallSid && activeCallSid === callSid) {
    logger.info(`Call ${callSid} ended, releasing lock.`);
    isCallActive = false;
    activeCallSid = null;
  }
};
