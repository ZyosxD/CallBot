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

let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

// Allow bypassing operating hours during tests via environment variable
const checkOperatingHours = () => {
  if (process.env.IGNORE_OPERATING_HOURS === 'true') {
    return true;
  }

  const now = dayjs().tz('America/Denver');
  const time = now.hour() + now.minute() / 60;

  // 9:30 AM - 11:30 AM
  const isMorning = time >= 9.5 && time <= 11.5;
  // 2:30 PM - 3:30 PM
  const isAfternoon = time >= 14.5 && time <= 15.5;

  return isMorning || isAfternoon;
};

export const startDrip = () => {
  if (dripInterval) return;

  dripInterval = setInterval(async () => {
    try {
      if (isCallActive) return;

      if (!checkOperatingHours()) {
        logger.info('Outside operating hours. Pausing Smart Drip.');
        return;
      }

      const clientsRaw = fs.readFileSync(clientsPath, 'utf8');
      const clients = JSON.parse(clientsRaw);

      const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');
      if (nextClientIndex === -1) {
        logger.info('No more PENDING clients. Stopping Smart Drip.');
        stopDrip();
        return;
      }

      const client = clients[nextClientIndex];
      isCallActive = true;

      // Mark as CALLED immediately before dial
      clients[nextClientIndex].status = 'CALLED';
      fs.writeFileSync(clientsPath, JSON.stringify(clients, null, 2));

      logger.info(`Initiating outbound call to ${client.name} at ${client.phone}`);

      const clientTwilio = twilio(config.twilio.accountSid, config.twilio.authToken);

      const call = await clientTwilio.calls.create({
        to: client.phone,
        from: config.twilio.phoneNumber,
        statusCallback: `${config.server.publicUrl}/voice/status-callback`,
        statusCallbackEvent: ['completed'],
        twiml: `
          <Response>
            <Connect>
              <Stream url="wss://${new URL(config.server.publicUrl).host}/voice/stream">
                <Parameter name="callerId" value="${client.phone}" />
                <Parameter name="mode" value="outbound" />
              </Stream>
            </Connect>
          </Response>
        `
      });

      activeCallSid = call.sid;
      logger.info(`Outbound call initiated with SID: ${activeCallSid}`);

    } catch (error) {
      logger.error('Error in Smart Drip execution:', error);
      isCallActive = false;
      activeCallSid = null;
    }
  }, 10000); // Check every 10 seconds
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
  }
};

export const markCallEnded = (callSid) => {
  if (activeCallSid === callSid) {
    logger.info(`Outbound call ${callSid} ended. Releasing lock.`);
    isCallActive = false;
    activeCallSid = null;
  }
};
