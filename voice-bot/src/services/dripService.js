import fs from 'fs';
import path from 'path';
import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import isBetween from 'dayjs/plugin/isBetween.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isBetween);

let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const CLIENTS_FILE = path.join(process.cwd(), 'clients.json');

// Helper to read and parse clients.json safely
function getClients() {
  try {
    if (!fs.existsSync(CLIENTS_FILE)) {
      fs.writeFileSync(CLIENTS_FILE, JSON.stringify([]));
      return [];
    }
    const data = fs.readFileSync(CLIENTS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    logger.error('Error reading clients.json:', error);
    return [];
  }
}

// Helper to save clients.json safely
function saveClients(clients) {
  try {
    fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));
  } catch (error) {
    logger.error('Error writing clients.json:', error);
  }
}

// Helper to check if current time is within dialing hours
function isWithinDialingHours() {
  const now = dayjs().tz('America/Denver');

  const morningStart = now.hour(9).minute(30).second(0);
  const morningEnd = now.hour(11).minute(30).second(0);

  const afternoonStart = now.hour(14).minute(30).second(0); // 2:30 PM
  const afternoonEnd = now.hour(15).minute(30).second(0);   // 3:30 PM

  const isMorning = now.isBetween(morningStart, morningEnd);
  const isAfternoon = now.isBetween(afternoonStart, afternoonEnd);

  return isMorning || isAfternoon;
}

export const startDrip = () => {
  logger.info('Initializing Smart Drip service...');

  if (dripInterval) {
    clearInterval(dripInterval);
  }

  // Polling every 15 seconds to check if we should make a call
  dripInterval = setInterval(async () => {
    try {
      if (isCallActive) {
        return; // A call is already happening
      }

      if (!isWithinDialingHours()) {
        return; // Not within hours, wait for next tick
      }

      const clients = getClients();
      const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

      if (nextClientIndex === -1) {
        return; // No more pending clients
      }

      const nextClient = clients[nextClientIndex];
      logger.info(`Starting outbound call to ${nextClient.phone}`);

      isCallActive = true;

      const client = twilio(config.twilio.accountSid, config.twilio.authToken);

      const call = await client.calls.create({
        to: nextClient.phone,
        from: config.twilio.phoneNumber,
        url: `${config.server.publicUrl}/voice/inbound`,
        statusCallback: `${config.server.publicUrl}/voice/inbound/status`,
        machineDetection: 'Enable',
        // Optional parameters to pass state
        parameters: { callerId: nextClient.phone, mode: 'outbound' }
      });

      activeCallSid = call.sid;

      // Immediately mark as CALLED after Twilio successfully initiates the call
      clients[nextClientIndex].status = 'CALLED';
      saveClients(clients);

      logger.info(`Outbound call initiated with SID: ${activeCallSid}`);

    } catch (error) {
      logger.error('Error in Smart Drip loop:', error);
      // If the API call fails, release lock so it can try the next loop
      isCallActive = false;
      activeCallSid = null;
    }
  }, 15000); // Check every 15 seconds
};

export const markCallEnded = (callSid) => {
  if (activeCallSid === callSid) {
    logger.info(`Call ended via callback for active outbound call: ${callSid}. Releasing lock.`);
    isCallActive = false;
    activeCallSid = null;
  }
};

export const stopDrip = () => {
  logger.info('Stopping Smart Drip service...');
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
  }
};
