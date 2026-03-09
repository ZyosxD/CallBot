import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';
import twilio from 'twilio';

dayjs.extend(utc);
dayjs.extend(timezone);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientsPath = path.join(__dirname, '../data/clients.json');

let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const isWithinOperatingHours = () => {
  const denverTime = dayjs().tz('America/Denver');
  const startMorning = denverTime.hour(9).minute(30).second(0);
  const endMorning = denverTime.hour(11).minute(30).second(0);
  const startAfternoon = denverTime.hour(14).minute(30).second(0);
  const endAfternoon = denverTime.hour(15).minute(30).second(0);

  if ((denverTime.isAfter(startMorning) && denverTime.isBefore(endMorning)) ||
      (denverTime.isAfter(startAfternoon) && denverTime.isBefore(endAfternoon))) {
    return true;
  }
  return false;
};

const getNextPendingClient = () => {
  if (!fs.existsSync(clientsPath)) {
    logger.warn('clients.json not found');
    return null;
  }

  try {
    const clientsData = JSON.parse(fs.readFileSync(clientsPath, 'utf8'));
    const index = clientsData.findIndex(client => client.status === 'PENDING');

    if (index !== -1) {
      const client = clientsData[index];
      clientsData[index].status = 'CALLED';
      fs.writeFileSync(clientsPath, JSON.stringify(clientsData, null, 2));
      return client;
    }
  } catch (error) {
    logger.error('Error reading/writing clients.json:', error);
  }
  return null;
};

export const markCallEnded = (callSid) => {
  if (callSid && callSid === activeCallSid) {
    isCallActive = false;
    activeCallSid = null;
    logger.info(`Outbound call ${callSid} marked as ended. Ready for next call.`);
  } else if (!callSid) {
    // Fallback if callSid isn't provided, though less safe
    isCallActive = false;
    activeCallSid = null;
    logger.info('Call marked as ended (no sid provided). Ready for next call.');
  }
};

export const startDrip = () => {
  if (dripInterval) {
    logger.warn('Drip already running');
    return;
  }

  logger.info('Starting Smart Drip Engine');

  dripInterval = setInterval(async () => {
    if (!isWithinOperatingHours()) {
      logger.info('Outside of operating hours (Mountain Time). Waiting...');
      return;
    }

    if (isCallActive) {
      logger.info('A call is currently active. Waiting for completion...');
      return;
    }

    const client = getNextPendingClient();
    if (!client) {
      logger.info('No pending clients found in database.');
      return;
    }

    logger.info(`Initiating call for client: ${client.name} (${client.phone})`);
    isCallActive = true;

    try {
      const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

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

      const callbackUrl = `${config.server.publicUrl}/voice/status-callback`;

      const call = await twilioClient.calls.create({
        twiml: twiml,
        to: client.phone,
        from: config.twilio.phoneNumber,
        statusCallback: callbackUrl,
        statusCallbackEvent: ['completed'],
        statusCallbackMethod: 'POST'
      });

      activeCallSid = call.sid;
      logger.info(`Call initiated. SID: ${call.sid}`);
    } catch (error) {
      logger.error(`Error initiating call to ${client.phone}:`, error);
      isCallActive = false;
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
