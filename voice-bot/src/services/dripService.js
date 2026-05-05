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

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isBetween);
dayjs.extend(customParseFormat);

const clientsFile = path.resolve('src/data/clients.json');
let twilioClient;

try {
  twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
} catch (error) {
  logger.error('Failed to initialize Twilio client:', error);
}

let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const checkOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const morningStart = now.hour(9).minute(30).second(0);
  const morningEnd = now.hour(11).minute(30).second(0);
  const afternoonStart = now.hour(14).minute(30).second(0);
  const afternoonEnd = now.hour(15).minute(30).second(0);

  return now.isBetween(morningStart, morningEnd) || now.isBetween(afternoonStart, afternoonEnd);
};

const getPendingClient = () => {
  if (!fs.existsSync(clientsFile)) return null;
  const clients = JSON.parse(fs.readFileSync(clientsFile, 'utf8'));
  return clients.find(client => client.status === 'PENDING');
};

const markClientCalled = (phone) => {
  if (!fs.existsSync(clientsFile)) return;
  const clients = JSON.parse(fs.readFileSync(clientsFile, 'utf8'));
  const updatedClients = clients.map(client =>
    client.phone === phone ? { ...client, status: 'CALLED' } : client
  );
  fs.writeFileSync(clientsFile, JSON.stringify(updatedClients, null, 2));
};

export const startDrip = () => {
  if (dripInterval) return;
  logger.info('Starting Smart Drip service...');

  dripInterval = setInterval(async () => {
    if (isCallActive) {
      logger.info('Call in progress, waiting...');
      return;
    }

    if (!checkOperatingHours()) {
      logger.info('Outside of operating hours (Denver time 9:30-11:30 or 14:30-15:30). Waiting...');
      return;
    }

    const client = getPendingClient();
    if (!client) {
      logger.info('No pending clients found. Waiting...');
      return;
    }

    try {
      logger.info(`Initiating outbound call to ${client.phone}`);
      isCallActive = true;
      markClientCalled(client.phone);

      const twimlUrl = `${config.server.publicUrl}/voice/outbound?callerId=${encodeURIComponent(client.phone)}`;

      const call = await twilioClient.calls.create({
        to: client.phone,
        from: config.twilio.phoneNumber,
        url: twimlUrl,
        statusCallback: `${config.server.publicUrl}/voice/inbound/status`,
        statusCallbackMethod: 'POST'
      });

      activeCallSid = call.sid;
      logger.info(`Call initiated with SID: ${call.sid}`);

    } catch (error) {
      logger.error('Error initiating outbound call:', error);
      isCallActive = false; // Reset on failure
    }
  }, 15000); // Check every 15 seconds
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Smart Drip service stopped.');
  }
};

export const markCallEnded = (callSid) => {
  if (activeCallSid && activeCallSid === callSid) {
    logger.info(`Outbound call ${callSid} ended. Releasing lock.`);
    isCallActive = false;
    activeCallSid = null;
  }
};
