import fs from 'fs';
import path from 'path';
import twilio from 'twilio';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import isBetween from 'dayjs/plugin/isBetween.js';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';
import { fileURLToPath } from 'url';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isBetween);
dayjs.extend(customParseFormat);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientsFilePath = path.join(__dirname, '../data/clients.json');

const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

let isCallActive = false;
let activeCallSid = null;
let dripTimer = null;

const checkOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const morningStart = now.clone().hour(9).minute(30).second(0);
  const morningEnd = now.clone().hour(11).minute(30).second(0);
  const afternoonStart = now.clone().hour(14).minute(30).second(0);
  const afternoonEnd = now.clone().hour(15).minute(30).second(0);

  const isMorning = now.isBetween(morningStart, morningEnd, 'second', '[]');
  const isAfternoon = now.isBetween(afternoonStart, afternoonEnd, 'second', '[]');

  return isMorning || isAfternoon;
};

const processNextClient = async () => {
  if (isCallActive) return;
  if (!checkOperatingHours()) {
    logger.info('Outside of operating hours (Mountain Time: 9:30-11:30 & 14:30-15:30). Waiting...');
    return;
  }

  let clients = [];
  try {
    const data = fs.readFileSync(clientsFilePath, 'utf8');
    clients = JSON.parse(data);
  } catch (err) {
    logger.error('Error reading clients.json:', err);
    return;
  }

  const pendingIndex = clients.findIndex(c => c.status === 'PENDING');
  if (pendingIndex === -1) {
    logger.info('No PENDING clients left.');
    return;
  }

  const client = clients[pendingIndex];
  logger.info(`Starting drip call to ${client.phone}`);

  try {
    isCallActive = true;

    // Twiml URL containing the callerId and outbound flag
    // We shouldn't use inline twiml with URL, so we construct the URL that hit our inbound route
    // which will generate the stream TwiML. For outbound, our callController expects the TwiML
    // from /voice/inbound. We pass the client's phone as the To parameter.
    const url = `${config.server.publicUrl}/voice/inbound`;

    const call = await twilioClient.calls.create({
      url: url,
      to: client.phone,
      from: config.twilio.phoneNumber,
      statusCallback: `${config.server.publicUrl}/voice/inbound/status`,
      // Intentionally not restricting statusCallbackEvent
    });

    activeCallSid = call.sid;
    logger.info(`Call initiated, Sid: ${activeCallSid}`);

    // Mark as CALLED only after successfully initiating
    clients[pendingIndex].status = 'CALLED';
    fs.writeFileSync(clientsFilePath, JSON.stringify(clients, null, 2));

  } catch (error) {
    logger.error('Failed to initiate call:', error);
    isCallActive = false;
    activeCallSid = null;
  }
};

export const startDrip = () => {
  if (dripTimer) return;
  logger.info('Starting Smart Drip Engine...');
  dripTimer = setInterval(processNextClient, 10000); // Poll every 10s
};

export const stopDrip = () => {
  if (dripTimer) {
    clearInterval(dripTimer);
    dripTimer = null;
    logger.info('Stopped Smart Drip Engine.');
  }
};

export const markCallEnded = (callSid) => {
  if (callSid && callSid === activeCallSid) {
    logger.info(`Releasing lock for call ${callSid}`);
    isCallActive = false;
    activeCallSid = null;
  }
};
