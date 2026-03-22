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
  const startMorning = now.clone().hour(9).minute(30).second(0);
  const endMorning = now.clone().hour(11).minute(30).second(0);
  const startAfternoon = now.clone().hour(14).minute(30).second(0);
  const endAfternoon = now.clone().hour(15).minute(30).second(0);

  return (now.isAfter(startMorning) && now.isBefore(endMorning)) ||
         (now.isAfter(startAfternoon) && now.isBefore(endAfternoon));
};

const readClients = () => {
  try {
    const data = fs.readFileSync(CLIENTS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    logger.error('Error reading clients.json:', error);
    return [];
  }
};

const saveClients = (clients) => {
  try {
    fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2), 'utf8');
  } catch (error) {
    logger.error('Error saving clients.json:', error);
  }
};

const initiateNextCall = async () => {
  if (isCallActive) {
    return;
  }

  if (!isWithinOperatingHours()) {
    logger.info('Outside operating hours. Pausing drip.');
    return;
  }

  const clients = readClients();
  const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

  if (nextClientIndex === -1) {
    logger.info('No more pending clients in the list.');
    return;
  }

  const client = clients[nextClientIndex];

  // Important logic to prevent data loss or duplicates:
  // Update to CALLED immediately before executing
  clients[nextClientIndex].status = 'CALLED';
  saveClients(clients);

  isCallActive = true;
  logger.info(`Initiating smart drip call to ${client.name} at ${client.phone}`);

  try {
    const twiml = `
      <Response>
        <Connect>
          <Stream url="wss://${new URL(config.server.publicUrl).host}/voice/stream">
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
      // Intentionally omitting statusCallbackEvent to receive all statuses to ensure locks release
    });

    activeCallSid = call.sid;
    logger.info(`Call started successfully with SID: ${call.sid}`);
  } catch (error) {
    logger.error('Error initiating outbound call:', error);
    isCallActive = false;
    activeCallSid = null;
  }
};

export const startDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
  }
  // Check every 30 seconds
  dripInterval = setInterval(initiateNextCall, 30000);
  initiateNextCall();
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
  }
};

export const markCallEnded = (callSid) => {
  if (activeCallSid === callSid) {
    isCallActive = false;
    activeCallSid = null;
    logger.info(`Call ${callSid} ended, released drip lock.`);
  }
};
