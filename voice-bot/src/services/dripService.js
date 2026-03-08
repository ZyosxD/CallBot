import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import fs from 'fs/promises';
import path from 'path';
import twilio from 'twilio';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientsPath = path.join(__dirname, '../data/clients.json');

const TIMEZONE = 'America/Denver';
let isCallActive = false;
let dripInterval = null;

export const isWithinOperatingHours = () => {
  const now = dayjs().tz(TIMEZONE);
  const hour = now.hour();
  const minute = now.minute();
  const timeInMinutes = hour * 60 + minute;

  // 9:30 AM = 9 * 60 + 30 = 570
  // 11:30 AM = 11 * 60 + 30 = 690
  const isMorning = timeInMinutes >= 570 && timeInMinutes <= 690;

  // 2:30 PM = 14 * 60 + 30 = 870
  // 3:30 PM = 15 * 60 + 30 = 930
  const isAfternoon = timeInMinutes >= 870 && timeInMinutes <= 930;

  return isMorning || isAfternoon;
};

export const startDrip = () => {
  if (dripInterval) {
    logger.info('Drip service already running.');
    return;
  }
  logger.info('Starting Smart Drip service.');
  dripInterval = setInterval(processDrip, 15000); // Check every 15 seconds
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Stopped Smart Drip service.');
  }
};

export const releaseCallLock = () => {
    isCallActive = false;
    logger.info('Call lock released.');
};

const processDrip = async () => {
  if (isCallActive) {
    // Only debug log so we don't spam the console too heavily if we use 15s intervals
    return;
  }

  if (!isWithinOperatingHours()) {
    return;
  }

  isCallActive = true;
  logger.info('Initiating next outbound call...');

  try {
     const data = await fs.readFile(clientsPath, 'utf-8');
     const clients = JSON.parse(data);

     const targetClientIndex = clients.findIndex(c => c.status === 'PENDING');
     if (targetClientIndex === -1) {
         logger.info('No pending clients found. Releasing lock.');
         isCallActive = false;
         return;
     }

     const targetClient = clients[targetClientIndex];
     logger.info(`Found pending client: ${targetClient.name} (${targetClient.phone})`);

     // 2. Mark immediately as CALLED to prevent mathematical duplicates
     clients[targetClientIndex].status = 'CALLED';
     await fs.writeFile(clientsPath, JSON.stringify(clients, null, 2), 'utf-8');

     // Ensure publicUrl is set before making calls (required for statusCallback and webhooks in real environment, though not strictly required for inline TwiML if using absolute ws:// url. However, we'll need it for WSS construction)
     if (!config.server.publicUrl) {
         logger.error('PUBLIC_URL is missing. Cannot proceed with outbound calls.');
         isCallActive = false;
         return;
     }

     const wsUrl = config.server.publicUrl.replace(/^http/, 'ws') + '/voice/stream';

     // 3. Execute the call via Twilio
     const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

     // Build inline TwiML with custom parameters callerId and mode="outbound"
     const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Connect>
        <Stream url="${wsUrl}">
            <Parameter name="callerId" value="${targetClient.phone}" />
            <Parameter name="mode" value="outbound" />
        </Stream>
    </Connect>
</Response>`;

     const call = await twilioClient.calls.create({
         twiml: twiml,
         to: targetClient.phone,
         from: config.twilio.phoneNumber,
         statusCallback: `${config.server.publicUrl}/voice/status-callback`,
         statusCallbackEvent: ['completed'] // Must be strictly this array for Twilio validation
     });

     logger.info(`Outbound call initiated successfully. Call SID: ${call.sid}`);

  } catch (error) {
     logger.error('Error executing outbound call:', error);
     isCallActive = false;
  }
};
