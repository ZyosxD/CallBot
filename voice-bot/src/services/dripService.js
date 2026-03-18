import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import twilio from 'twilio';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientsPath = path.join(__dirname, '../data/clients.json');

let twilioClient;
let isCallActive = false;
export let activeCallSid = null;
let dripInterval = null;

export const startDrip = () => {
  if (!config.server.publicUrl) {
    logger.warn('Cannot start drip service: PUBLIC_URL is not set.');
    return;
  }

  twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
  logger.info('Starting Smart Drip service...');

  // Check every 30 seconds
  dripInterval = setInterval(processDripQueue, 30000);
  processDripQueue();
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
  }
  logger.info('Smart Drip service stopped.');
};

const isWithinOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const time = now.hour() * 100 + now.minute();

  // Morning: 9:30 AM - 11:30 AM (930 - 1130)
  // Afternoon: 2:30 PM - 3:30 PM (1430 - 1530)
  return (time >= 930 && time <= 1130) || (time >= 1430 && time <= 1530);
};

const processDripQueue = async () => {
  if (isCallActive) {
    logger.info('Drip service: A call is currently active. Waiting...');
    return;
  }

  if (!isWithinOperatingHours()) {
    logger.info('Drip service: Outside operating hours.');
    return;
  }

  try {
    const clientsData = fs.readFileSync(clientsPath, 'utf-8');
    const clients = JSON.parse(clientsData);

    const pendingClientIndex = clients.findIndex(c => c.status === 'PENDING');
    if (pendingClientIndex === -1) {
      logger.info('Drip service: No pending clients.');
      return;
    }

    const clientToCall = clients[pendingClientIndex];
    logger.info(`Drip service: Calling ${clientToCall.name} at ${clientToCall.phone}...`);

    // Lock
    isCallActive = true;

    // Immediately mark as called
    clients[pendingClientIndex].status = 'CALLED';
    fs.writeFileSync(clientsPath, JSON.stringify(clients, null, 2));

    const twiml = `
      <Response>
        <Connect>
          <Stream url="wss://${new URL(config.server.publicUrl).host}/voice/stream">
            <Parameter name="callerId" value="${clientToCall.phone}" />
            <Parameter name="mode" value="outbound" />
          </Stream>
        </Connect>
      </Response>
    `;

    const call = await twilioClient.calls.create({
      twiml: twiml,
      to: clientToCall.phone,
      from: config.twilio.phoneNumber,
      statusCallback: `${config.server.publicUrl}/voice/status-callback`,
      statusCallbackEvent: ['completed']
    });

    activeCallSid = call.sid;
    logger.info(`Twilio call initiated: ${call.sid}`);

  } catch (error) {
    logger.error('Error in Drip service queue processor:', error);
    // Release lock on error
    isCallActive = false;
    activeCallSid = null;
  }
};

export const markCallEnded = (sid) => {
  if (activeCallSid && activeCallSid === sid) {
    logger.info(`Drip service: Marking call ${sid} as ended. Releasing lock.`);
    isCallActive = false;
    activeCallSid = null;
  }
};
