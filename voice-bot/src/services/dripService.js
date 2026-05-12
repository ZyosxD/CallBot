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
const clientsFilePath = path.resolve('clients.json');

let dripInterval = null;
let isCallActive = false;
let activeCallSid = null;

// Initialize clients.json if missing
if (!fs.existsSync(clientsFilePath)) {
  fs.writeFileSync(clientsFilePath, JSON.stringify([]));
}

const getClients = () => {
  try {
    return JSON.parse(fs.readFileSync(clientsFilePath, 'utf8'));
  } catch (error) {
    logger.error('Error reading clients.json:', error);
    return [];
  }
};

const saveClients = (clients) => {
  try {
    fs.writeFileSync(clientsFilePath, JSON.stringify(clients, null, 2));
  } catch (error) {
    logger.error('Error saving clients.json:', error);
  }
};

const isWithinOperatingHours = () => {
  const now = dayjs().tz('America/Denver');

  const morningStart = now.hour(9).minute(30).second(0);
  const morningEnd = now.hour(11).minute(30).second(0);

  const afternoonStart = now.hour(14).minute(30).second(0);
  const afternoonEnd = now.hour(15).minute(30).second(0);

  return now.isBetween(morningStart, morningEnd) || now.isBetween(afternoonStart, afternoonEnd);
};

export const startDrip = () => {
  if (dripInterval) return;
  logger.info('Starting Smart Drip Engine');

  dripInterval = setInterval(async () => {
    if (!isWithinOperatingHours()) {
      return; // Wait for operating hours, don't stop interval
    }

    if (isCallActive) {
      return; // Wait for current call to finish
    }

    const clients = getClients();
    const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (nextClientIndex === -1) {
      return; // No pending clients, wait for new ones
    }

    const client = clients[nextClientIndex];
    logger.info(`Initiating call to ${client.phone} (ID: ${client.id})`);

    // Lock to prevent concurrency
    isCallActive = true;

    try {
      // Mark as CALLED immediately before calling to prevent duplicates
      clients[nextClientIndex].status = 'CALLED';
      saveClients(clients);

      const twiml = new twilio.twiml.VoiceResponse();
      const connect = twiml.connect();
      const stream = connect.stream({
        url: `wss://${new URL(config.server.publicUrl).host}/voice/stream`,
      });
      stream.parameter({
        name: 'callerId',
        value: client.phone // Crucial for report matching
      });
      stream.parameter({
        name: 'mode',
        value: 'outbound'
      });

      const call = await twilioClient.calls.create({
        twiml: twiml.toString(),
        to: client.phone,
        from: config.twilio.phoneNumber,
        statusCallback: `${config.server.publicUrl}/voice/inbound/status`
      });

      activeCallSid = call.sid;
      logger.info(`Outbound call created: ${call.sid}`);

    } catch (error) {
      logger.error(`Error calling client ${client.phone}:`, error);
      isCallActive = false; // Release lock on error
      activeCallSid = null;
    }

  }, 10000); // Check every 10 seconds
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Smart Drip Engine stopped');
  }
};

export const markCallEnded = (callSid) => {
  if (callSid === activeCallSid) {
    logger.info(`Outbound call ${callSid} ended, releasing lock.`);
    isCallActive = false;
    activeCallSid = null;
  }
};
