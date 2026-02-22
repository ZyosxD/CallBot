import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLIENTS_FILE = path.join(__dirname, '../data/clients.json');

let dripInterval = null;
let isCallActive = false;
let currentCallSid = null;

const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

const isWithinOperatingHours = () => {
  const now = dayjs().tz("America/Denver");
  const hour = now.hour();
  const minute = now.minute();

  // Morning: 09:30 - 11:30
  const isMorning = (hour === 9 && minute >= 30) || (hour === 10) || (hour === 11 && minute < 30);

  // Afternoon: 14:30 - 15:30 (2:30 PM - 3:30 PM)
  const isAfternoon = (hour === 14 && minute >= 30) || (hour === 15 && minute < 30);

  return isMorning || isAfternoon;
};

const getPendingClient = async () => {
  try {
    const data = await fs.readFile(CLIENTS_FILE, 'utf-8');
    const clients = JSON.parse(data);
    return clients.find(c => c.status === 'PENDING');
  } catch (error) {
    logger.error('Error reading clients file:', error);
    return null;
  }
};

const updateClientStatus = async (clientId, status) => {
  try {
    const data = await fs.readFile(CLIENTS_FILE, 'utf-8');
    let clients = JSON.parse(data);
    const clientIndex = clients.findIndex(c => c.id == clientId); // Loose equality for string/number mismatch
    if (clientIndex !== -1) {
      clients[clientIndex].status = status;
      clients[clientIndex].lastCalled = new Date().toISOString();
      await fs.writeFile(CLIENTS_FILE, JSON.stringify(clients, null, 2));
    }
  } catch (error) {
    logger.error('Error updating client status:', error);
  }
};

const makeNextCall = async () => {
  if (isCallActive) {
    // Check if we need to terminate call because operating hours ended
    if (!isWithinOperatingHours() && currentCallSid) {
      logger.info('Operating hours ended. Terminating active call respectfully.');
      try {
        await twilioClient.calls(currentCallSid).update({ status: 'completed' });
        logger.info(`Call ${currentCallSid} terminated.`);
      } catch (error) {
        logger.error(`Error terminating call ${currentCallSid}:`, error);
      }
    }
    // logger.info('Call already in progress. Skipping cycle.'); // Commented to reduce log spam
    return;
  }

  if (!isWithinOperatingHours()) {
    // logger.info('Outside operating hours. Skipping call.');
    return;
  }

  const client = await getPendingClient();
  if (!client) {
    // logger.info('No pending clients found.');
    return;
  }

  try {
    isCallActive = true;
    logger.info(`Initiating call to ${client.name} (${client.phone})`);

    // Mark as CALLED immediately to prevent duplicates
    await updateClientStatus(client.id, 'CALLED');

    // Add query params for callerId
    const twimlUrl = new URL(`${config.server.publicUrl}/voice/outbound-twiml`);
    twimlUrl.searchParams.append('clientId', client.id);
    twimlUrl.searchParams.append('clientName', client.name); // Pass name for context if needed

    const call = await twilioClient.calls.create({
      url: twimlUrl.toString(),
      to: client.phone,
      from: config.twilio.phoneNumber,
      statusCallback: `${config.server.publicUrl}/voice/status-callback`,
      statusCallbackEvent: ['completed', 'busy', 'no-answer', 'failed', 'canceled'],
      statusCallbackMethod: 'POST'
    });

    currentCallSid = call.sid;
    logger.info(`Call initiated: ${call.sid}`);

  } catch (error) {
    logger.error('Error making call:', error);
    isCallActive = false;
    currentCallSid = null;
    await updateClientStatus(client.id, 'FAILED_INIT');
  }
};

export const startDrip = () => {
  if (dripInterval) {
    logger.warn('Drip service already running.');
    return;
  }

  logger.info('Starting Smart Drip Service...');
  makeNextCall();
  dripInterval = setInterval(makeNextCall, 60 * 1000); // Check every minute
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Stopped Smart Drip Service.');
  }
  // Clear any pending timeout if exists (not used here, but good practice)
};

export const notifyCallEnded = (callSid) => {
  // If callSid matches current or isCallActive is true (maybe check against stored sid)
  // We use loose check because callSid might be undefined if error happened before sid was set,
  // but statusCallback should have it.
  if (currentCallSid === callSid || (callSid && isCallActive)) {
    logger.info(`Call ended: ${callSid}. Releasing lock.`);
    isCallActive = false;
    currentCallSid = null;
  }
};

export default { startDrip, stopDrip, notifyCallEnded };
