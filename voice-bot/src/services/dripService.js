import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import twilio from 'twilio';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientsFilePath = path.join(__dirname, '../data/clients.json');

let dripInterval;
let isCallActive = false;
let activeCallSid = null;

export const isWithinOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const timeStr = now.format('HH:mm');

  const isMorning = timeStr >= '09:30' && timeStr <= '11:30';
  const isAfternoon = timeStr >= '14:30' && timeStr <= '15:30';

  return isMorning || isAfternoon;
};

export const startDrip = () => {
  logger.info('Starting Smart Drip Engine...');
  // Check every 30 seconds
  dripInterval = setInterval(processNextCall, 30000);
  processNextCall(); // Check immediately on start
};

export const stopDrip = () => {
  logger.info('Stopping Smart Drip Engine...');
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
  }
};

export const markCallEnded = (callSid) => {
  if (activeCallSid === callSid) {
    logger.info(`Call ${callSid} ended. Releasing lock.`);
    isCallActive = false;
    activeCallSid = null;
  }
};

const processNextCall = async () => {
  if (isCallActive) {
    logger.info('A call is currently active. Waiting...');
    return;
  }

  if (!isWithinOperatingHours()) {
    logger.info('Outside operating hours in Mountain Time. Waiting...');
    return;
  }

  try {
    const clientsData = fs.readFileSync(clientsFilePath, 'utf8');
    const clients = JSON.parse(clientsData);

    const pendingClientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (pendingClientIndex === -1) {
      logger.info('No pending clients found. Waiting...');
      return;
    }

    const client = clients[pendingClientIndex];
    logger.info(`Initiating call to ${client.name} (${client.phone})`);

    // Mark as called immediately before Twilio API call
    clients[pendingClientIndex].status = 'CALLED';
    fs.writeFileSync(clientsFilePath, JSON.stringify(clients, null, 2), 'utf8');

    isCallActive = true;

    const clientTwilio = twilio(config.twilio.accountSid, config.twilio.authToken);

    // Use twiml inline so we don't need a separate URL
    const twiml = `
      <Response>
        <Connect>
          <Stream url="wss://${new URL(config.server.publicUrl).host}/voice/stream">
            <Parameter name="mode" value="outbound" />
            <Parameter name="callerId" value="${client.phone}" />
          </Stream>
        </Connect>
      </Response>
    `;

    const call = await clientTwilio.calls.create({
      twiml: twiml,
      to: client.phone,
      from: config.twilio.phoneNumber,
      statusCallback: `${config.server.publicUrl}/voice/status-callback`
    });

    activeCallSid = call.sid;
    logger.info(`Call initiated successfully. CallSid: ${call.sid}`);

  } catch (error) {
    logger.error('Error processing next call in drip campaign:', error);
    // Release lock on error so we can try again
    isCallActive = false;
    activeCallSid = null;
  }
};
