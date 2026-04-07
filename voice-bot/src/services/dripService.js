import fs from 'fs';
import path from 'path';
import twilio from 'twilio';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const clientsFile = path.resolve('src/data/clients.json');

export let isCallActive = false;
export let activeCallSid = null;
let dripInterval = null;

const client = twilio(config.twilio.accountSid, config.twilio.authToken);

function isWithinOperatingHours() {
  const now = dayjs().tz('America/Denver');
  const timeNum = now.hour() * 100 + now.minute();
  const isMorning = timeNum >= 930 && timeNum < 1130;
  const isAfternoon = timeNum >= 1430 && timeNum < 1530;
  return isMorning || isAfternoon;
}

export const startDrip = () => {
  if (dripInterval) return;
  logger.info('Smart Drip engine started.');

  dripInterval = setInterval(async () => {
    if (isCallActive) {
      return;
    }

    if (!isWithinOperatingHours()) {
      return;
    }

    try {
      if (!fs.existsSync(clientsFile)) return;
      const data = fs.readFileSync(clientsFile, 'utf8');
      const clients = JSON.parse(data);

      const targetIndex = clients.findIndex(c => c.status === 'PENDING');
      if (targetIndex === -1) {
        return; // No pending clients, wait for next cycle
      }

      const targetClient = clients[targetIndex];
      logger.info(`Initiating outbound call to ${targetClient.phone}`);

      // Lock before API call
      isCallActive = true;

      const callUrl = config.server.publicUrl
        ? `https://${config.server.publicUrl}/voice/inbound`
        : `http://localhost:${config.server.port}/voice/inbound`;

      const call = await client.calls.create({
        to: targetClient.phone,
        from: config.twilio.phoneNumber,
        url: `${callUrl}?callerId=${encodeURIComponent(targetClient.phone)}`,
        statusCallback: `${callUrl}/status`,
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed', 'busy', 'failed', 'no-answer', 'canceled']
      });

      activeCallSid = call.sid;

      // Mark as CALLED immediately
      clients[targetIndex].status = 'CALLED';
      fs.writeFileSync(clientsFile, JSON.stringify(clients, null, 2));

    } catch (error) {
      logger.error('Error in drip engine:', error);
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

export const markCallEnded = (callSid) => {
  if (activeCallSid === callSid) {
    isCallActive = false;
    activeCallSid = null;
    logger.info(`Outbound call ended. Released lock for ${callSid}`);
  }
};
