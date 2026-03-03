import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import twilio from 'twilio';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientsPath = path.join(__dirname, '../data/clients.json');

export let isCallActive = false;
let dripInterval = null;

const isWithinOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const timeStr = now.format('HH:mm');

  // Morning: 9:30 AM - 11:30 AM (09:30 - 11:30)
  // Afternoon: 2:30 PM - 3:30 PM (14:30 - 15:30)
  const isMorning = timeStr >= '09:30' && timeStr <= '11:30';
  const isAfternoon = timeStr >= '14:30' && timeStr <= '15:30';

  return isMorning || isAfternoon;
};

export const startDrip = () => {
  if (dripInterval) return;

  logger.info('Starting Smart Drip service...');

  dripInterval = setInterval(async () => {
    if (isCallActive) {
      return;
    }

    if (!isWithinOperatingHours()) {
      return;
    }

    try {
      let clients = [];
      if (fs.existsSync(clientsPath)) {
        clients = JSON.parse(fs.readFileSync(clientsPath, 'utf8'));
      }

      const clientIndex = clients.findIndex(c => c.status === 'PENDING');

      if (clientIndex !== -1) {
        const clientToCall = clients[clientIndex];

        // Mark as CALLED immediately
        clients[clientIndex].status = 'CALLED';
        fs.writeFileSync(clientsPath, JSON.stringify(clients, null, 2));

        await initiateCall(clientToCall.phone);
      }
    } catch (error) {
      logger.error('Error in Drip Service:', error);
    }
  }, 10000); // Check every 10 seconds
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Smart Drip service stopped.');
  }
};

export const setCallInactive = () => {
  isCallActive = false;
  logger.info('Call concurrency lock released.');
};

const initiateCall = async (phoneNumber) => {
  isCallActive = true;
  logger.info(`Initiating outbound call to ${phoneNumber}`);

  const client = twilio(config.twilio.accountSid, config.twilio.authToken);

  const twiml = new twilio.twiml.VoiceResponse();
  const connect = twiml.connect();
  const stream = connect.stream({
    url: `wss://${new URL(config.server.publicUrl).host}/voice/stream`,
  });
  stream.parameter({ name: 'callerId', value: phoneNumber });
  stream.parameter({ name: 'mode', value: 'outbound' });

  try {
    await client.calls.create({
      twiml: twiml.toString(),
      to: phoneNumber,
      from: config.twilio.phoneNumber,
      statusCallback: `${config.server.publicUrl}/voice/status-callback`,
      statusCallbackEvent: ['completed', 'failed', 'busy', 'no-answer', 'canceled']
    });
    logger.info(`Outbound call dispatched to ${phoneNumber}`);
  } catch (error) {
    logger.error('Error initiating outbound call:', error);
    isCallActive = false; // Release lock if creation fails
  }
};
