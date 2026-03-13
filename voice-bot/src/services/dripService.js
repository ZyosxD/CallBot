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

let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

export const isWithinOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const time = now.hour() * 100 + now.minute();

  const morningStart = 930;
  const morningEnd = 1130;
  const afternoonStart = 1430;
  const afternoonEnd = 1530;

  return (
    (time >= morningStart && time <= morningEnd) ||
    (time >= afternoonStart && time <= afternoonEnd)
  );
};

export const markCallEnded = (callSid) => {
  if (callSid === activeCallSid) {
    logger.info(`Outbound call ${callSid} completed. Releasing lock.`);
    isCallActive = false;
    activeCallSid = null;
  }
};

const getClients = () => {
  if (!fs.existsSync(CLIENTS_FILE)) return [];
  const data = fs.readFileSync(CLIENTS_FILE, 'utf-8');
  return JSON.parse(data);
};

const saveClients = (clients) => {
  fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));
};

export const executeDripCall = async () => {
  if (isCallActive) {
    return;
  }

  if (!isWithinOperatingHours()) {
    if (activeCallSid) {
      try {
        const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
        await twilioClient.calls(activeCallSid).update({
          twiml: '<Response><Say>Our operating hours have ended. We will reach out later. Goodbye.</Say><Hangup/></Response>'
        });
        logger.info(`Operating hours ended. Ending call ${activeCallSid}`);
      } catch (err) {
        logger.error(`Error ending call at end of operating hours: ${err}`);
      }
    }
    return;
  }

  const clients = getClients();
  const nextClient = clients.find((c) => c.status === 'PENDING');

  if (!nextClient) {
    return;
  }

  const clientPhone = nextClient.phone;
  logger.info(`Initiating outbound call to ${clientPhone}`);

  const hostUrl = config.server.publicUrl.replace(/^https?:\/\//, '');

  try {
    isCallActive = true;

    // We construct the TwiML directly to avoid external requests
    const twimlStr = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Connect>
        <Stream url="wss://${hostUrl}/voice/stream">
            <Parameter name="callerId" value="${clientPhone}" />
            <Parameter name="mode" value="outbound" />
        </Stream>
    </Connect>
</Response>`;

    const client = twilio(config.twilio.accountSid, config.twilio.authToken);
    const call = await client.calls.create({
      twiml: twimlStr,
      to: clientPhone,
      from: config.twilio.phoneNumber,
      statusCallback: `${config.server.publicUrl}/voice/status-callback`,
      statusCallbackEvent: ['completed']
    });

    activeCallSid = call.sid;
    logger.info(`Call initiated. SID: ${call.sid}`);

    // Mark as called immediately to prevent duplicates
    nextClient.status = 'CALLED';
    saveClients(clients);

  } catch (error) {
    logger.error('Error initiating outbound call:', error);
    isCallActive = false;
    activeCallSid = null;
  }
};

export const startDrip = () => {
  logger.info('Starting Smart Drip service.');
  dripInterval = setInterval(executeDripCall, 10000);
};

export const stopDrip = () => {
  logger.info('Stopping Smart Drip service.');
  if (dripInterval) clearInterval(dripInterval);
};
