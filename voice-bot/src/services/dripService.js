import fs from 'fs';
import path from 'path';
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

let dripInterval = null;
let isCallActive = false;
let activeCallSid = null;

const CLIENTS_FILE = path.join(process.cwd(), 'src', 'data', 'clients.json');

const getClients = () => {
  try {
    const data = fs.readFileSync(CLIENTS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    logger.error('Error reading clients.json:', error);
    return [];
  }
};

const saveClients = (clients) => {
  try {
    fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2), 'utf8');
  } catch (error) {
    logger.error('Error writing clients.json:', error);
  }
};

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

  logger.info('Starting Smart Drip Engine...');

  dripInterval = setInterval(async () => {
    if (isCallActive) return;

    if (!isWithinOperatingHours()) {
      return;
    }

    const clients = getClients();
    const clientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (clientIndex === -1) {
      return;
    }

    const client = clients[clientIndex];

    // Lock it immediately
    isCallActive = true;

    try {
      const clientObj = twilio(config.twilio.accountSid, config.twilio.authToken);

      const twimlUrl = new URL(`/voice/stream`, config.server.publicUrl || 'http://localhost');
      twimlUrl.protocol = twimlUrl.protocol === 'https:' ? 'wss:' : 'ws:';

      const twiml = `
        <Response>
          <Connect>
            <Stream url="${twimlUrl.toString()}">
              <Parameter name="mode" value="outbound" />
              <Parameter name="callerId" value="${client.phone}" />
            </Stream>
          </Connect>
        </Response>
      `;

      logger.info(`Initiating outbound call to ${client.phone}`);

      const call = await clientObj.calls.create({
        twiml: twiml,
        to: client.phone,
        from: config.twilio.phoneNumber,
        statusCallback: `${config.server.publicUrl}/voice/status`,
      });

      activeCallSid = call.sid;

      // Update status to CALLED right after successful initiation
      clients[clientIndex].status = 'CALLED';
      saveClients(clients);

      logger.info(`Call initiated. CallSid: ${activeCallSid}`);
    } catch (error) {
      logger.error('Error initiating outbound call:', error);
      isCallActive = false;
      activeCallSid = null;
    }

  }, 10000); // Check every 10 seconds
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Smart Drip Engine stopped.');
  }
};

export const markCallEnded = (callSid) => {
  if (isCallActive && activeCallSid === callSid) {
    logger.info(`Releasing lock for call ${callSid}`);
    isCallActive = false;
    activeCallSid = null;
  }
};
