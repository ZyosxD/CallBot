import fs from 'fs';
import path from 'path';
import twilio from 'twilio';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import isBetween from 'dayjs/plugin/isBetween.js';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isBetween);

const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
const clientsFilePath = path.join(process.cwd(), 'src', 'data', 'clients.json');

let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const isWithinOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const morningStart = now.hour(9).minute(30).second(0);
  const morningEnd = now.hour(11).minute(30).second(0);
  const afternoonStart = now.hour(14).minute(30).second(0);
  const afternoonEnd = now.hour(15).minute(30).second(0);

  return now.isBetween(morningStart, morningEnd) || now.isBetween(afternoonStart, afternoonEnd);
};

const readClients = () => {
  try {
    if (!fs.existsSync(clientsFilePath)) return [];
    const data = fs.readFileSync(clientsFilePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    logger.error('Error reading clients.json:', error);
    return [];
  }
};

const writeClients = (clients) => {
  try {
    fs.writeFileSync(clientsFilePath, JSON.stringify(clients, null, 2));
  } catch (error) {
    logger.error('Error writing clients.json:', error);
  }
};

const processNextCall = async () => {
  if (isCallActive) {
    return;
  }

  if (!isWithinOperatingHours()) {
    return;
  }

  const clients = readClients();
  const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

  if (nextClientIndex === -1) {
    return;
  }

  const client = clients[nextClientIndex];
  clients[nextClientIndex].status = 'CALLED';
  writeClients(clients);

  try {
    isCallActive = true;
    logger.info(`Initiating outbound call to ${client.phone}`);

    // Construct inline TwiML directly without a separate URL
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

    const call = await twilioClient.calls.create({
      twiml: twiml,
      to: client.phone,
      from: config.twilio.phoneNumber,
      statusCallback: `${config.server.publicUrl}/voice/outbound/status`
      // Omit statusCallbackEvent restriction to get all updates
    });

    activeCallSid = call.sid;
    logger.info(`Call initiated with SID: ${activeCallSid}`);
  } catch (error) {
    logger.error('Error initiating outbound call:', error);
    // On error, we release the lock so the drip can continue later or to another number
    isCallActive = false;
    activeCallSid = null;
  }
};

export const startDrip = () => {
  if (dripInterval) {
    logger.warn('Drip is already running.');
    return;
  }
  logger.info('Starting Smart Drip Engine...');
  // Poll every 30 seconds
  dripInterval = setInterval(processNextCall, 30000);
  processNextCall(); // Run immediately
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Stopped Smart Drip Engine.');
  }
};

export const markCallEnded = (callSid) => {
  if (callSid && callSid === activeCallSid) {
    logger.info(`Call ${callSid} ended. Releasing outbound lock.`);
    isCallActive = false;
    activeCallSid = null;
  }
};
