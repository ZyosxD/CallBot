import twilio from 'twilio';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientsFilePath = path.join(__dirname, '../data/clients.json');

let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

const isWithinOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const timeStr = now.format('HH:mm');

  return (timeStr >= '09:30' && timeStr <= '11:30') || (timeStr >= '14:30' && timeStr <= '15:30');
};

const getNextPendingClient = () => {
  try {
    if (!fs.existsSync(clientsFilePath)) return null;
    const data = JSON.parse(fs.readFileSync(clientsFilePath, 'utf8'));
    const index = data.findIndex(client => client.status === 'PENDING');
    if (index !== -1) {
      const client = data[index];
      // Mark as called
      data[index].status = 'CALLED';
      fs.writeFileSync(clientsFilePath, JSON.stringify(data, null, 2), 'utf8');
      return client;
    }
  } catch (error) {
    logger.error('Error reading/updating clients.json:', error);
  }
  return null;
};

export const startDrip = () => {
  if (dripInterval) {
    logger.info('Drip service already running.');
    return;
  }

  logger.info('Starting Smart Drip Service...');
  dripInterval = setInterval(async () => {
    if (!isWithinOperatingHours()) {
      logger.info('Outside operating hours. Pausing drip...');
      return;
    }

    if (isCallActive) {
      logger.info('A call is currently active. Waiting...');
      return;
    }

    const client = getNextPendingClient();
    if (!client) {
      logger.info('No pending clients found in the queue.');
      return;
    }

    try {
      isCallActive = true;
      logger.info(`Initiating call to ${client.phone} (${client.name})...`);

      const twimlUrl = new URL(config.server.publicUrl + '/voice/inbound');
      twimlUrl.searchParams.append('callerId', client.phone);
      twimlUrl.searchParams.append('mode', 'outbound');

      // The status callback event allows us to know when the call completes
      const call = await twilioClient.calls.create({
        to: client.phone,
        from: config.twilio.phoneNumber,
        url: twimlUrl.toString(),
        statusCallback: config.server.publicUrl + '/voice/status-callback',
        statusCallbackEvent: ['completed'],
        statusCallbackMethod: 'POST',
      });

      activeCallSid = call.sid;
      logger.info(`Call initiated with SID: ${activeCallSid}`);
    } catch (error) {
      logger.error(`Error calling client ${client.phone}:`, error);
      isCallActive = false;
      activeCallSid = null;
    }
  }, 60000); // Check every minute
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Smart Drip Service stopped.');
  }
};

export const markCallEnded = (callSid) => {
  if (activeCallSid === callSid) {
    logger.info(`Outbound call ended. Releasing lock.`);
    isCallActive = false;
    activeCallSid = null;
  }
};
