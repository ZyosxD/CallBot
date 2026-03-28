import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import fs from 'fs/promises';
import path from 'path';
import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const clientsPath = path.resolve('src/data/clients.json');
let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const isWithinOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const time = now.format('HH:mm');

  const isMorning = time >= '09:30' && time <= '11:30';
  const isAfternoon = time >= '14:30' && time <= '15:30';

  return isMorning || isAfternoon;
};

const readClients = async () => {
  try {
    const data = await fs.readFile(clientsPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    logger.error('Error reading clients.json:', error);
    return [];
  }
};

const writeClients = async (clients) => {
  try {
    await fs.writeFile(clientsPath, JSON.stringify(clients, null, 2));
  } catch (error) {
    logger.error('Error writing clients.json:', error);
  }
};

const dialNextContact = async () => {
  if (isCallActive) return;
  if (!isWithinOperatingHours()) return;

  const clients = await readClients();
  const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

  if (nextClientIndex === -1) return;

  const client = clients[nextClientIndex];
  isCallActive = true;
  clients[nextClientIndex].status = 'CALLED';
  await writeClients(clients);

  try {
    const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
    const host = config.server.publicUrl.replace(/^https?:\/\//, '');

    logger.info(`Initiating outbound call to ${client.phone}`);

    const call = await twilioClient.calls.create({
      to: client.phone,
      from: config.twilio.phoneNumber,
      twiml: `
        <Response>
          <Connect>
            <Stream url="wss://${host}/voice/stream">
              <Parameter name="callerId" value="${client.phone}" />
              <Parameter name="mode" value="outbound" />
            </Stream>
          </Connect>
        </Response>
      `,
      statusCallback: `${config.server.publicUrl}/voice/status-callback`,
      // Intentionally omitting statusCallbackEvent to receive all events
    });

    activeCallSid = call.sid;
    logger.info(`Outbound call initiated with SID: ${activeCallSid}`);
  } catch (error) {
    logger.error('Error initiating outbound call:', error);
    isCallActive = false;
    activeCallSid = null;
  }
};

export const startDrip = () => {
  if (!dripInterval) {
    logger.info('Starting Smart Drip engine...');
    // Check every 30 seconds
    dripInterval = setInterval(dialNextContact, 30000);
    // Try to run immediately once
    dialNextContact();
  }
};

export const stopDrip = () => {
  if (dripInterval) {
    logger.info('Stopping Smart Drip engine...');
    clearInterval(dripInterval);
    dripInterval = null;
  }
};

export const markCallEnded = (callSid) => {
  if (callSid === activeCallSid) {
    logger.info(`Active call ${callSid} ended, releasing lock.`);
    isCallActive = false;
    activeCallSid = null;
  }
};
