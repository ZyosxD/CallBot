import fs from 'fs/promises';
import path from 'path';
import twilio from 'twilio';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import isBetween from 'dayjs/plugin/isBetween.js';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';
import { fileURLToPath } from 'url';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isBetween);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientsPath = path.join(__dirname, '..', 'data', 'clients.json');

const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const isWithinOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const morningStart = now.hour(9).minute(30).second(0);
  const morningEnd = now.hour(11).minute(30).second(0);
  const afternoonStart = now.hour(14).minute(30).second(0);
  const afternoonEnd = now.hour(15).minute(30).second(0);

  return now.isBetween(morningStart, morningEnd) || now.isBetween(afternoonStart, afternoonEnd);
};

export const startDrip = () => {
  if (dripInterval) return;

  logger.info('Starting Smart Drip engine...');
  dripInterval = setInterval(async () => {
    if (isCallActive) {
      return;
    }

    if (!isWithinOperatingHours()) {
      return;
    }

    try {
      const data = await fs.readFile(clientsPath, 'utf8');
      const clients = JSON.parse(data);

      const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');
      if (nextClientIndex === -1) {
        return;
      }

      isCallActive = true;
      const client = clients[nextClientIndex];

      // Update status immediately before dialing
      clients[nextClientIndex].status = 'CALLED';
      await fs.writeFile(clientsPath, JSON.stringify(clients, null, 2));

      logger.info(`Dialing next client: ${client.phone}`);

      const call = await twilioClient.calls.create({
        to: client.phone,
        from: config.twilio.phoneNumber,
        twiml: `<Response><Connect><Stream url="wss://${new URL(config.server.publicUrl).host}/voice/stream"><Parameter name="callerId" value="${client.phone}" /><Parameter name="mode" value="outbound" /></Stream></Connect></Response>`,
        statusCallback: `${config.server.publicUrl}/voice/outbound/status`,
      });

      activeCallSid = call.sid;
      logger.info(`Outbound call initiated. SID: ${activeCallSid}`);
    } catch (error) {
      logger.error('Error in drip iteration:', error);
      isCallActive = false;
      activeCallSid = null;
    }
  }, 10000); // Check every 10 seconds
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Stopped Smart Drip engine.');
  }
};

export const markCallEnded = (callSid) => {
  if (callSid === activeCallSid) {
    logger.info(`Releasing lock for call SID: ${callSid}`);
    isCallActive = false;
    activeCallSid = null;
  }
};
