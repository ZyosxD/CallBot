import fs from 'fs/promises';
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

const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const isWithinOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const hour = now.hour();
  const minute = now.minute();
  const timeInMinutes = hour * 60 + minute;

  const morningStart = 9 * 60 + 30; // 9:30 AM
  const morningEnd = 11 * 60 + 30;  // 11:30 AM
  const afternoonStart = 14 * 60 + 30; // 2:30 PM
  const afternoonEnd = 15 * 60 + 30;   // 3:30 PM

  return (timeInMinutes >= morningStart && timeInMinutes <= morningEnd) ||
         (timeInMinutes >= afternoonStart && timeInMinutes <= afternoonEnd);
};

const processNextCall = async () => {
  if (isCallActive) {
    logger.info('A call is currently active. Waiting...');
    return;
  }

  if (!isWithinOperatingHours()) {
    logger.info('Outside of operating hours (Denver Time). Waiting...');
    return;
  }

  try {
    const clientsData = await fs.readFile(clientsFilePath, 'utf-8');
    let clients = JSON.parse(clientsData);

    const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (nextClientIndex === -1) {
      logger.info('No pending clients to call. Waiting...');
      return;
    }

    const client = clients[nextClientIndex];

    // Set lock
    isCallActive = true;

    // Initiate call
    logger.info(`Initiating outbound call to ${client.phone}`);
    const twimlUrl = `${config.server.publicUrl}/voice/outbound?callerId=${encodeURIComponent(client.phone)}`;

    const call = await twilioClient.calls.create({
      to: client.phone,
      from: config.twilio.phoneNumber,
      url: twimlUrl,
      statusCallback: `${config.server.publicUrl}/voice/inbound/status`,
      // Do not restrict statusCallbackEvent to ensure we get all events to clear locks
    });

    activeCallSid = call.sid;
    logger.info(`Outbound call started: ${call.sid}`);

    // Mark as CALLED only after successfully initiating
    clients[nextClientIndex].status = 'CALLED';
    await fs.writeFile(clientsFilePath, JSON.stringify(clients, null, 2));

  } catch (error) {
    logger.error('Error processing next call:', error);
    // Release lock on error
    isCallActive = false;
    activeCallSid = null;
  }
};

export const startDrip = () => {
  if (!dripInterval) {
    logger.info('Starting Smart Drip Engine...');
    // Check every 30 seconds
    dripInterval = setInterval(processNextCall, 30000);
    // Trigger first check immediately
    processNextCall();
  }
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Smart Drip Engine stopped.');
  }
};

export const markCallEnded = (callSid) => {
  if (activeCallSid === callSid) {
    logger.info(`Clearing active call lock for ${callSid}`);
    isCallActive = false;
    activeCallSid = null;
  }
};
