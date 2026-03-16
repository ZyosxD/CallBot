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
const clientsFilePath = path.join(__dirname, '../data/clients.json');

let dripInterval = null;
export let isCallActive = false;
export let activeCallSid = null;

const getClients = () => {
  try {
    if (!fs.existsSync(clientsFilePath)) {
      // Ensure data directory exists
      fs.mkdirSync(path.join(__dirname, '../data'), { recursive: true });
      fs.writeFileSync(clientsFilePath, '[]', 'utf8');
      return [];
    }
    const data = fs.readFileSync(clientsFilePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    logger.error('Error reading clients file:', error);
    return [];
  }
};

const saveClients = (clients) => {
  try {
    fs.writeFileSync(clientsFilePath, JSON.stringify(clients, null, 2), 'utf8');
  } catch (error) {
    logger.error('Error writing clients file:', error);
  }
};

const isWithinOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const timeStr = now.format('HH:mm');
  const inMorning = timeStr >= '09:30' && timeStr <= '11:30';
  const inAfternoon = timeStr >= '14:30' && timeStr <= '15:30';
  return inMorning || inAfternoon;
};

export const startDrip = () => {
  if (dripInterval) {
    logger.warn('Drip service is already running.');
    return;
  }

  logger.info('Starting Smart Drip Engine...');

  dripInterval = setInterval(async () => {
    if (isCallActive) {
      return; // Wait for the current call to finish
    }

    if (!isWithinOperatingHours()) {
      return; // Do nothing if outside operating hours
    }

    const clients = getClients();
    const pendingClientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (pendingClientIndex === -1) {
      // No pending clients
      return;
    }

    const client = clients[pendingClientIndex];
    logger.info(`Starting drip call to ${client.name} (${client.phone})`);

    // Mark as called immediately before Twilio call
    client.status = 'CALLED';
    saveClients(clients);

    isCallActive = true;

    try {
      const clientPhone = client.phone;
      const twimlUrl = new URL(config.server.publicUrl);
      const host = twimlUrl.host;

      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${host}/voice/stream">
      <Parameter name="callerId" value="${clientPhone}" />
      <Parameter name="mode" value="outbound" />
    </Stream>
  </Connect>
</Response>`;

      const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
      const call = await twilioClient.calls.create({
        twiml: twiml,
        to: clientPhone,
        from: config.twilio.phoneNumber,
        statusCallback: `${config.server.publicUrl}/voice/status-callback`,
        statusCallbackEvent: ['completed'],
        statusCallbackMethod: 'POST'
      });

      activeCallSid = call.sid;
      logger.info(`Outbound call initiated with SID: ${activeCallSid}`);

    } catch (error) {
      logger.error('Failed to initiate outbound call:', error);
      // Release lock on failure
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
  if (callSid === activeCallSid) {
    isCallActive = false;
    activeCallSid = null;
    logger.info(`Drip lock released for CallSid: ${callSid}`);
  }
};
