import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLIENTS_FILE = path.join(__dirname, '../data/clients.json');

let dripInterval = null;
let isCallActive = false; // Simple lock
let currentCallSid = null;

export const startDrip = () => {
  if (dripInterval) {
    logger.warn('Drip service already running.');
    return;
  }

  if (!config.server.publicUrl) {
    logger.warn('Drip Service cannot start: PUBLIC_URL not set.');
    return;
  }

  logger.info('Starting Smart Drip Service...');
  // Check every minute
  dripInterval = setInterval(checkAndCall, 60 * 1000);
  checkAndCall(); // Run immediately on start
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Drip Service stopped.');
  }
};

export const setCallActive = (active, callSid = null) => {
  isCallActive = active;
  currentCallSid = active ? callSid : null;
  if (!active) {
    logger.info('Call lock released. Ready for next call.');
  }
};

const checkAndCall = async () => {
  const now = dayjs().tz('America/Denver');
  const currentHour = now.hour();
  const currentMinute = now.minute();

  // Operating Hours: 9:30 - 11:30 AND 14:30 - 15:30
  const isMorningSlot = (currentHour === 9 && currentMinute >= 30) || (currentHour === 10) || (currentHour === 11 && currentMinute < 30);
  const isAfternoonSlot = (currentHour === 14 && currentMinute >= 30) || (currentHour === 15 && currentMinute < 30);

  if (!isMorningSlot && !isAfternoonSlot) {
    if (isCallActive && currentCallSid) {
        logger.info(`Outside operating hours. Terminating active call ${currentCallSid}...`);
        try {
            const clientTwilio = twilio(config.twilio.accountSid, config.twilio.authToken);
            await clientTwilio.calls(currentCallSid).update({ status: 'completed' });
            setCallActive(false);
        } catch (error) {
            logger.error(`Error terminating call ${currentCallSid}:`, error);
        }
    } else {
        logger.info(`Outside operating hours (${now.format('HH:mm')} MT). Drip paused.`);
    }
    return;
  }

  if (isCallActive) {
    logger.info('Call currently active. Skipping drip cycle.');
    return;
  }

  try {
    if (!fs.existsSync(CLIENTS_FILE)) {
        logger.error(`Clients file not found at ${CLIENTS_FILE}`);
        return;
    }
    const clients = JSON.parse(fs.readFileSync(CLIENTS_FILE, 'utf8'));
    const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (nextClientIndex === -1) {
      logger.info('No PENDING clients found.');
      return;
    }

    const client = clients[nextClientIndex];
    logger.info(`Initiating call to ${client.name} (${client.phone})...`);

    // Mark as CALLED immediately to prevent duplicates
    clients[nextClientIndex].status = 'CALLED';
    clients[nextClientIndex].lastCalled = now.toISOString();
    fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));

    // Make the call
    await makeCall(client);

  } catch (error) {
    logger.error('Error in drip cycle:', error);
  }
};

const makeCall = async (client) => {
  isCallActive = true;
  const clientTwilio = twilio(config.twilio.accountSid, config.twilio.authToken);

  const response = new twilio.twiml.VoiceResponse();
  const connect = response.connect();
  const stream = connect.stream({
    url: `wss://${config.server.publicUrl.replace(/^https?:\/\//, '')}/voice/stream`,
  });

  // Pass custom parameters to the stream
  stream.parameter({
    name: 'callerId',
    value: client.phone
  });
  stream.parameter({
    name: 'mode',
    value: 'OUTBOUND'
  });

  try {
    const call = await clientTwilio.calls.create({
      twiml: response.toString(),
      to: client.phone,
      from: config.twilio.phoneNumber,
      statusCallback: `${config.server.publicUrl}/voice/status-callback`,
      statusCallbackEvent: ['completed', 'busy', 'no-answer', 'failed', 'canceled']
    });

    logger.info(`Call initiated: ${call.sid}`);
    setCallActive(true, call.sid);
  } catch (error) {
    logger.error(`Failed to call ${client.name}:`, error);
    isCallActive = false; // Release lock if call fails to initiate
  }
};
