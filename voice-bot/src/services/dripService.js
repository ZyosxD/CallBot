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

const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
const CLIENTS_FILE = path.join(process.cwd(), 'src', 'data', 'clients.json');

let dripInterval = null;
let isCallActive = false;
let activeCallSid = null;

const getClients = () => {
  try {
    if (!fs.existsSync(CLIENTS_FILE)) return [];
    const data = fs.readFileSync(CLIENTS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    logger.error('Error reading clients file:', error);
    return [];
  }
};

const saveClients = (clients) => {
  try {
    fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));
  } catch (error) {
    logger.error('Error writing clients file:', error);
  }
};

const isWithinOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const hour = now.hour();
  const minute = now.minute();
  const timeInMinutes = hour * 60 + minute;

  const morningStart = 9 * 60 + 30; // 9:30 AM
  const morningEnd = 11 * 60 + 30; // 11:30 AM
  const afternoonStart = 14 * 60 + 30; // 2:30 PM
  const afternoonEnd = 15 * 60 + 30; // 3:30 PM

  return (timeInMinutes >= morningStart && timeInMinutes <= morningEnd) ||
         (timeInMinutes >= afternoonStart && timeInMinutes <= afternoonEnd);
};

export const markCallEnded = (endedCallSid) => {
  if (activeCallSid === endedCallSid) {
    logger.info(`Call ${endedCallSid} ended. Releasing lock.`);
    isCallActive = false;
    activeCallSid = null;
  }
};

const executeDrip = async () => {
  if (isCallActive) return;

  if (!isWithinOperatingHours()) {
    logger.info('Outside of operating hours (Denver Time). Waiting...');
    return;
  }

  const clients = getClients();
  const pendingIndex = clients.findIndex(c => c.status === 'PENDING');

  if (pendingIndex === -1) {
    logger.info('No PENDING clients found. Waiting...');
    return;
  }

  isCallActive = true;
  const client = clients[pendingIndex];
  logger.info(`Initiating call to ${client.phone} (${client.name})`);

  try {
    const host = config.server.publicUrl ? new URL(config.server.publicUrl).host : 'localhost:3000';
    // Use absolute URL for the WebSocket stream and include custom parameters in TwiML
    const twiml = `
      <Response>
        <Connect>
          <Stream url="wss://${host}/voice/stream">
            <Parameter name="callerId" value="${client.phone}" />
            <Parameter name="mode" value="outbound" />
          </Stream>
        </Connect>
      </Response>
    `;

    const publicUrl = config.server.publicUrl || 'http://localhost:3000';
    const statusCallbackUrl = `${publicUrl}/voice/statusCallback`;

    const call = await twilioClient.calls.create({
      twiml: twiml,
      to: client.phone,
      from: config.twilio.phoneNumber,
      statusCallback: statusCallbackUrl,
    });

    activeCallSid = call.sid;

    // Mark as called immediately after successful initiation
    clients[pendingIndex].status = 'CALLED';
    saveClients(clients);

    logger.info(`Call created successfully with SID: ${call.sid}`);
  } catch (error) {
    logger.error('Error initiating outbound call:', error);
    isCallActive = false;
  }
};

export const startDrip = () => {
  if (dripInterval) return;
  logger.info('Starting Smart Drip campaign engine...');
  dripInterval = setInterval(executeDrip, 30000); // Check every 30 seconds
  executeDrip(); // Execute immediately once
};

export const stopDrip = () => {
  if (dripInterval) {
    logger.info('Stopping Smart Drip campaign engine...');
    clearInterval(dripInterval);
    dripInterval = null;
  }
};
