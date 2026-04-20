import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';
import fs from 'fs';
import path from 'path';

dayjs.extend(utc);
dayjs.extend(timezone);

const clientsFile = path.resolve('src/data/clients.json');
let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const isWithinOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const hour = now.hour();
  const minute = now.minute();
  const time = hour + minute / 60;

  // 9:30 AM = 9.5, 11:30 AM = 11.5
  const isMorning = time >= 9.5 && time < 11.5;
  // 2:30 PM = 14.5, 3:30 PM = 15.5
  const isAfternoon = time >= 14.5 && time < 15.5;

  return isMorning || isAfternoon;
};

const readClients = () => {
  try {
    if (!fs.existsSync(clientsFile)) return [];
    return JSON.parse(fs.readFileSync(clientsFile, 'utf8'));
  } catch (error) {
    logger.error('Error reading clients.json', error);
    return [];
  }
};

const saveClients = (clients) => {
  try {
    fs.writeFileSync(clientsFile, JSON.stringify(clients, null, 2), 'utf8');
  } catch (error) {
    logger.error('Error writing clients.json', error);
  }
};

const dialNextClient = async () => {
  if (isCallActive) {
    return; // Wait for the active call to finish
  }

  if (!isWithinOperatingHours()) {
    logger.info('Outside operating hours. Waiting...');
    return; // Keep interval alive but do nothing
  }

  const clients = readClients();
  const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

  if (nextClientIndex === -1) {
    logger.info('No pending clients to call.');
    return;
  }

  const client = clients[nextClientIndex];

  try {
    isCallActive = true;
    logger.info(`Initiating call to ${client.name} at ${client.phone}`);

    const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

    // Construct TwiML
    const twiml = `
      <Response>
        <Connect>
          <Stream url="wss://${config.server.publicUrl.replace(/^https?:\/\//, '')}/voice/stream">
            <Parameter name="mode" value="outbound" />
            <Parameter name="callerId" value="${client.phone}" />
          </Stream>
        </Connect>
      </Response>
    `;

    const call = await twilioClient.calls.create({
      to: client.phone,
      from: config.twilio.phoneNumber,
      twiml: twiml,
      statusCallback: `${config.server.publicUrl}/voice/outbound/status`,
      // Do not restrict statusCallbackEvent to ensure we get all states
    });

    activeCallSid = call.sid;
    logger.info(`Call initiated with SID: ${call.sid}`);

    // Mark as CALLED only after successfully initiating the call
    clients[nextClientIndex].status = 'CALLED';
    saveClients(clients);

  } catch (error) {
    logger.error(`Failed to call ${client.phone}:`, error);
    isCallActive = false; // Release lock on error
  }
};

export const markCallEnded = (callSid) => {
  if (callSid === activeCallSid) {
    logger.info(`Releasing lock for call SID: ${callSid}`);
    isCallActive = false;
    activeCallSid = null;
  }
};

export const startDrip = () => {
  if (dripInterval) {
    logger.warn('Drip campaign is already running.');
    return;
  }
  logger.info('Starting Smart Drip campaign...');
  // Poll every 30 seconds
  dripInterval = setInterval(dialNextClient, 30000);
  dialNextClient(); // Call immediately on start
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Smart Drip campaign stopped.');
  }
};
