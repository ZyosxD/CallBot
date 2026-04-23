import twilio from 'twilio';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import isBetween from 'dayjs/plugin/isBetween.js';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';

import { config } from '../config/config.js';
import logger from '../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isBetween);
dayjs.extend(customParseFormat);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientsFilePath = path.join(__dirname, '../data/clients.json');

let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const getClients = () => {
  if (!fs.existsSync(clientsFilePath)) return [];
  const raw = fs.readFileSync(clientsFilePath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
};

const saveClients = (clients) => {
  fs.writeFileSync(clientsFilePath, JSON.stringify(clients, null, 2), 'utf8');
};

const isWithinOperatingHours = () => {
  const now = dayjs().tz('America/Denver');

  // Morning 9:30 AM - 11:30 AM
  const morningStart = now.hour(9).minute(30).second(0);
  const morningEnd = now.hour(11).minute(30).second(0);

  // Afternoon 2:30 PM (14:30) - 3:30 PM (15:30)
  const afternoonStart = now.hour(14).minute(30).second(0);
  const afternoonEnd = now.hour(15).minute(30).second(0);

  return now.isBetween(morningStart, morningEnd) || now.isBetween(afternoonStart, afternoonEnd);
};

export const markCallEnded = (callSid) => {
  if (activeCallSid === callSid) {
    logger.info(`Releasing lock for Outbound CallSid: ${callSid}`);
    isCallActive = false;
    activeCallSid = null;
  }
};

const executeDrip = async () => {
  if (isCallActive) {
    return;
  }

  if (!isWithinOperatingHours()) {
    // Return and wait, keeping the polling interval alive
    return;
  }

  const clients = getClients();
  const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

  if (nextClientIndex === -1) {
    // No more clients to call, wait.
    return;
  }

  const client = clients[nextClientIndex];

  // Set lock before async operations
  isCallActive = true;

  try {
    const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

    // Pass inline TwiML directly
    const twiml = `
      <Response>
        <Connect>
          <Stream url="wss://${config.server.publicUrl ? new URL(config.server.publicUrl).host : 'localhost:3000'}/voice/stream">
            <Parameter name="callerId" value="${client.phone}" />
            <Parameter name="mode" value="outbound" />
          </Stream>
        </Connect>
      </Response>
    `;

    const call = await twilioClient.calls.create({
      twiml,
      to: client.phone,
      from: config.twilio.phoneNumber,
      statusCallback: `${config.server.publicUrl || 'http://localhost:3000'}/voice/inbound/status`
    });

    activeCallSid = call.sid;
    logger.info(`Initiated outbound call to ${client.phone}, CallSid: ${call.sid}`);

    // Mark as CALLED immediately after initiating
    clients[nextClientIndex].status = 'CALLED';
    saveClients(clients);

  } catch (error) {
    logger.error(`Error initiating call to ${client.phone}:`, error);
    // Release lock on error
    isCallActive = false;
    activeCallSid = null;
  }
};

export const startDrip = () => {
  if (dripInterval) {
    return;
  }
  logger.info('Starting Smart Drip polling...');
  dripInterval = setInterval(executeDrip, 15000); // Poll every 15s
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Stopped Smart Drip polling.');
  }
};
