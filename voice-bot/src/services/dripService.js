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
const CLIENTS_FILE = path.join(__dirname, '../data/clients.json');

let dripInterval = null;
let isCallActive = false;
let activeCallSid = null;

const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

function isWithinOperatingHours() {
  const now = dayjs().tz('America/Denver');
  const h = now.hour();
  const m = now.minute();
  const time = h + m / 60;

  // 9:30 AM (9.5) to 11:30 AM (11.5)
  if (time >= 9.5 && time < 11.5) return true;
  // 2:30 PM (14.5) to 3:30 PM (15.5)
  if (time >= 14.5 && time < 15.5) return true;

  return false;
}

export const startDrip = () => {
  if (dripInterval) {
    logger.info('Drip service already running.');
    return;
  }

  logger.info('Starting Smart Drip Engine.');
  dripInterval = setInterval(async () => {
    if (!isWithinOperatingHours()) {
      return;
    }

    if (isCallActive) {
      return;
    }

    try {
      const data = fs.readFileSync(CLIENTS_FILE, 'utf8');
      const clients = JSON.parse(data);
      const pendingClientIndex = clients.findIndex(c => c.status === 'PENDING');

      if (pendingClientIndex === -1) {
        return;
      }

      const client = clients[pendingClientIndex];
      clients[pendingClientIndex].status = 'CALLED';
      fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));

      logger.info(`Initiating outbound call to ${client.phone}`);
      isCallActive = true;

      const twiml = `
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${(config.server.publicUrl || '').replace(/^https?:\/\//, '')}/voice/stream">
      <Parameter name="mode" value="outbound" />
      <Parameter name="callerId" value="${client.phone}" />
    </Stream>
  </Connect>
</Response>
      `;

      const call = await twilioClient.calls.create({
        twiml: twiml,
        to: client.phone,
        from: config.twilio.phoneNumber,
        statusCallback: `${config.server.publicUrl}/voice/status-callback`,
        statusCallbackMethod: 'POST'
      });

      activeCallSid = call.sid;
      logger.info(`Call initiated. SID: ${call.sid}`);

    } catch (error) {
      logger.error('Error in drip polling:', error);
      isCallActive = false;
      activeCallSid = null;
    }
  }, 10000); // Check every 10 seconds
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Drip service stopped.');
  }
};

export const markCallEnded = (sid) => {
  if (activeCallSid === sid) {
    isCallActive = false;
    activeCallSid = null;
    logger.info(`Call ${sid} ended. Releasing lock.`);
  }
};
