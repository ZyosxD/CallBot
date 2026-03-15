import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import twilio from 'twilio';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import isBetween from 'dayjs/plugin/isBetween.js';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isBetween);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLIENTS_FILE = path.resolve(__dirname, '../data/clients.json');

let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

export const isWithinOperatingHours = () => {
  const now = dayjs().tz('America/Denver');

  const morningStart = now.hour(9).minute(30).second(0);
  const morningEnd = now.hour(11).minute(30).second(0);

  const afternoonStart = now.hour(14).minute(30).second(0);
  const afternoonEnd = now.hour(15).minute(30).second(0);

  return now.isBetween(morningStart, morningEnd) || now.isBetween(afternoonStart, afternoonEnd);
};

export const markCallEnded = (callSid) => {
  if (activeCallSid === callSid) {
    logger.info(`Outbound call ${callSid} ended. Releasing lock.`);
    isCallActive = false;
    activeCallSid = null;
  }
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Drip Service Stopped.');
  }
};

export const startDrip = () => {
  if (!config.server.publicUrl) {
    logger.warn('PUBLIC_URL is not set. Drip Service will not start.');
    return;
  }

  logger.info('Starting Smart Drip Engine...');

  dripInterval = setInterval(async () => {
    if (isCallActive) return;

    if (!isWithinOperatingHours()) {
      // It's outside operating hours. Just return, we'll check again next interval.
      // The requirement states "Si una llamada está en curso cuando termina el horario, la termina respetuosamente, pero no inicia una nueva."
      // Since isCallActive is false here, no call is active. We don't start a new one.
      return;
    }

    try {
      if (!fs.existsSync(CLIENTS_FILE)) {
          fs.writeFileSync(CLIENTS_FILE, '[]');
      }

      const clientsData = fs.readFileSync(CLIENTS_FILE, 'utf8');
      let clients = JSON.parse(clientsData);

      const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

      if (nextClientIndex === -1) {
        // No more pending clients
        return;
      }

      const client = clients[nextClientIndex];
      logger.info(`Initiating outbound call to ${client.name} (${client.phone})`);

      isCallActive = true; // Lock
      clients[nextClientIndex].status = 'CALLED';
      fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));

      // Inline TwiML with custom parameters
      const twiml = `
        <Response>
          <Connect>
            <Stream url="wss://${config.server.publicUrl.replace(/^https?:\/\//, '')}/voice/stream">
              <Parameter name="callerId" value="${client.phone}" />
              <Parameter name="mode" value="outbound" />
            </Stream>
          </Connect>
        </Response>
      `;

      const call = await twilioClient.calls.create({
        twiml: twiml,
        to: client.phone,
        from: config.twilio.phoneNumber,
        statusCallback: `${config.server.publicUrl}/voice/status-callback`,
        statusCallbackEvent: ['completed'],
        statusCallbackMethod: 'POST'
      });

      activeCallSid = call.sid;
      logger.info(`Outbound call initiated. CallSid: ${activeCallSid}`);

    } catch (error) {
      logger.error('Error in Drip Service interval:', error);
      isCallActive = false; // Release lock on error
      activeCallSid = null;
    }

  }, 10000); // Check every 10 seconds
};
