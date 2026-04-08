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

let dripInterval = null;
let isCallActive = false;
export let activeCallSid = null;

const checkOperatingHours = () => {
  const nowMT = dayjs().tz('America/Denver');
  const hour = nowMT.hour();
  const minute = nowMT.minute();
  const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;

  // Morning: 9:30 AM - 11:30 AM (09:30 - 11:30)
  if (timeStr >= '09:30' && timeStr <= '11:30') return true;

  // Afternoon: 2:30 PM - 3:30 PM (14:30 - 15:30)
  if (timeStr >= '14:30' && timeStr <= '15:30') return true;

  return false;
};

const getNextClient = () => {
  try {
    const data = fs.readFileSync(clientsFilePath, 'utf8');
    const clients = JSON.parse(data);
    const clientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (clientIndex !== -1) {
      const client = clients[clientIndex];
      // Mark as CALLED to avoid mathematical duplicates
      clients[clientIndex].status = 'CALLED';
      fs.writeFileSync(clientsFilePath, JSON.stringify(clients, null, 2));
      return client;
    }
  } catch (error) {
    logger.error('Error reading/writing clients.json:', error);
  }
  return null;
};

const makeOutboundCall = async (client) => {
  if (!config.twilio.accountSid || !config.twilio.authToken || !config.server.publicUrl) {
    logger.warn('Twilio credentials or PUBLIC_URL missing, cannot make outbound call.');
    return;
  }

  isCallActive = true;
  logger.info(`Starting outbound call to ${client.phone}`);

  const clientTwilio = twilio(config.twilio.accountSid, config.twilio.authToken);
  const streamUrl = `wss://${new URL(config.server.publicUrl).host}/voice/stream?mode=outbound&callerId=${encodeURIComponent(client.phone)}`;

  try {
    const call = await clientTwilio.calls.create({
      to: client.phone,
      from: config.twilio.phoneNumber,
      twiml: `<Response><Connect><Stream url="${streamUrl}"/></Connect></Response>`,
      statusCallback: `${config.server.publicUrl}/voice/inbound/status`,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed', 'busy', 'failed', 'no-answer', 'canceled']
    });

    activeCallSid = call.sid;
    logger.info(`Outbound call initiated with SID: ${call.sid}`);
  } catch (error) {
    logger.error('Error initiating outbound call via Twilio:', error);
    isCallActive = false;
    activeCallSid = null;
  }
};

export const markCallEnded = (callSid) => {
  if (activeCallSid === callSid || activeCallSid === null) {
    logger.info(`Releasing lock for call SID: ${callSid}`);
    isCallActive = false;
    activeCallSid = null;
  }
};

export const startDrip = () => {
  logger.info('Initializing Smart Drip Campaign...');

  if (dripInterval) clearInterval(dripInterval);

  dripInterval = setInterval(async () => {
    if (isCallActive) {
      logger.debug('Call currently active, waiting...');
      return;
    }

    if (!checkOperatingHours()) {
      logger.debug('Outside operating hours. Waiting...');
      return;
    }

    const nextClient = getNextClient();
    if (!nextClient) {
      logger.debug('No pending clients found. Waiting...');
      return;
    }

    await makeOutboundCall(nextClient);

  }, 10000); // Check every 10 seconds
};

export const stopDrip = () => {
  logger.info('Stopping Smart Drip Campaign...');
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
  }
};
