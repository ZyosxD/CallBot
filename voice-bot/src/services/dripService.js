import fs from 'fs';
import path from 'path';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import logger from '../utils/logger.js';
import twilio from 'twilio';
import { config } from '../config/config.js';
import { fileURLToPath } from 'url';

dayjs.extend(utc);
dayjs.extend(timezone);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientsFilePath = path.join(__dirname, '../data/clients.json');

let dripInterval = null;
let isCallActive = false;
let activeCallSid = null;

const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

const isWithinOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const startMorning = now.hour(9).minute(30).second(0);
  const endMorning = now.hour(11).minute(30).second(0);
  const startAfternoon = now.hour(14).minute(30).second(0);
  const endAfternoon = now.hour(15).minute(30).second(0);

  const inMorning = now.isAfter(startMorning) && now.isBefore(endMorning);
  const inAfternoon = now.isAfter(startAfternoon) && now.isBefore(endAfternoon);

  return inMorning || inAfternoon;
};

const getPendingClient = () => {
  if (!fs.existsSync(clientsFilePath)) return null;
  const clients = JSON.parse(fs.readFileSync(clientsFilePath, 'utf8'));
  return clients.find(client => client.status === 'PENDING');
};

const markClientCalled = (phone) => {
  if (!fs.existsSync(clientsFilePath)) return;
  const clients = JSON.parse(fs.readFileSync(clientsFilePath, 'utf8'));
  const updatedClients = clients.map(client => {
    if (client.phone === phone) {
      return { ...client, status: 'CALLED' };
    }
    return client;
  });
  fs.writeFileSync(clientsFilePath, JSON.stringify(updatedClients, null, 2));
};

export const startDrip = () => {
  if (dripInterval) return;
  logger.info('Starting Smart Drip engine...');

  dripInterval = setInterval(async () => {
    if (!isWithinOperatingHours()) {
      // Return and wait, keep cron-like polling alive
      return;
    }

    if (isCallActive) {
      return;
    }

    const client = getPendingClient();
    if (!client) {
      return;
    }

    // Attempt to call the client
    isCallActive = true;
    try {
      logger.info(`Initiating outbound call to ${client.phone}`);

      const twimlUrl = new URL(`${config.server.publicUrl}/voice/outbound`);
      twimlUrl.searchParams.append('callerId', client.phone);

      const call = await twilioClient.calls.create({
        to: client.phone,
        from: config.twilio.phoneNumber,
        url: twimlUrl.toString(),
        statusCallback: `${config.server.publicUrl}/voice/status`,
      });

      activeCallSid = call.sid;
      markClientCalled(client.phone);
      logger.info(`Outbound call initiated with SID: ${activeCallSid}`);
    } catch (error) {
      logger.error('Error initiating outbound call:', error);
      isCallActive = false;
      activeCallSid = null;
    }
  }, 10000); // Check every 10 seconds
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Smart Drip engine stopped.');
  }
};

export const markCallEnded = (sid) => {
  if (activeCallSid === sid) {
    logger.info(`Call ended: ${sid}, releasing concurrency lock.`);
    isCallActive = false;
    activeCallSid = null;
  }
};
