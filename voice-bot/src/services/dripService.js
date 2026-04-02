import fs from 'fs';
import path from 'path';
import twilio from 'twilio';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';
import { fileURLToPath } from 'url';

dayjs.extend(utc);
dayjs.extend(timezone);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientsFilePath = path.join(__dirname, '../data/clients.json');

let isCallActive = false;
export let activeCallSid = null;
let dripInterval = null;

const isWithinOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const hour = now.hour();
  const minute = now.minute();
  const timeInMinutes = hour * 60 + minute;

  const morningStart = 9 * 60 + 30; // 9:30
  const morningEnd = 11 * 60 + 30; // 11:30
  const afternoonStart = 14 * 60 + 30; // 14:30
  const afternoonEnd = 15 * 60 + 30; // 15:30

  return (timeInMinutes >= morningStart && timeInMinutes <= morningEnd) ||
         (timeInMinutes >= afternoonStart && timeInMinutes <= afternoonEnd);
};

const getPendingClient = () => {
  try {
    const data = fs.readFileSync(clientsFilePath, 'utf8');
    const clients = JSON.parse(data);
    const index = clients.findIndex(c => c.status === 'PENDING');

    if (index !== -1) {
      const client = clients[index];
      // Mark as called immediately to prevent duplicates
      clients[index].status = 'CALLED';
      fs.writeFileSync(clientsFilePath, JSON.stringify(clients, null, 2));
      return client;
    }
    return null;
  } catch (error) {
    logger.error('Error reading/writing clients.json:', error);
    return null;
  }
};

const initiateCall = async (client) => {
  if (!config.twilio.accountSid || !config.twilio.authToken || !config.twilio.phoneNumber || !config.server.publicUrl) {
    logger.warn('Twilio or public URL config missing. Cannot initiate call.');
    return;
  }

  const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

  try {
    isCallActive = true;
    logger.info(`Initiating Smart Drip call to ${client.phone} (${client.name})`);

    // Pass callerId (client's phone) and mode (outbound) to TwiML URL
    const twimlUrl = `${config.server.publicUrl}/voice/outbound?callerId=${encodeURIComponent(client.phone)}`;
    const statusCallbackUrl = `${config.server.publicUrl}/voice/statusCallback`;

    const call = await twilioClient.calls.create({
      to: client.phone,
      from: config.twilio.phoneNumber,
      url: twimlUrl,
      statusCallback: statusCallbackUrl,
      // Do not restrict statusCallbackEvent to ensure we get all events to unlock
    });

    activeCallSid = call.sid;
    logger.info(`Call initiated with SID: ${call.sid}`);
  } catch (error) {
    logger.error(`Error initiating call to ${client.phone}:`, error);
    isCallActive = false; // unlock on error
    activeCallSid = null;
  }
};

export const startDrip = () => {
  if (dripInterval) return;

  logger.info('Smart Drip engine started.');

  dripInterval = setInterval(async () => {
    if (isCallActive) {
      return; // wait for current call to finish
    }

    if (!isWithinOperatingHours()) {
      return; // wait for operating hours
    }

    const client = getPendingClient();
    if (client) {
      await initiateCall(client);
    }
  }, 10000); // Poll every 10 seconds
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Smart Drip engine stopped.');
  }
};

export const markCallEnded = (callSid) => {
  if (callSid === activeCallSid) {
    logger.info(`Outbound call ${callSid} ended. Releasing lock.`);
    isCallActive = false;
    activeCallSid = null;
  }
};
