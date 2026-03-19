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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENTS_FILE = path.join(__dirname, '../data/clients.json');

let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const checkOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const time = now.format('HH:mm');

  const isMorning = time >= '09:30' && time <= '11:30';
  const isAfternoon = time >= '14:30' && time <= '15:30';

  return isMorning || isAfternoon;
};

const getPendingClient = () => {
  try {
    if (!fs.existsSync(CLIENTS_FILE)) return null;
    const data = fs.readFileSync(CLIENTS_FILE, 'utf8');
    const clients = JSON.parse(data);
    const clientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (clientIndex !== -1) {
      return { client: clients[clientIndex], index: clientIndex, clients };
    }
    return null;
  } catch (error) {
    logger.error('Error reading clients.json:', error);
    return null;
  }
};

const updateClientStatus = (clients, index, status) => {
  try {
    clients[index].status = status;
    fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));
  } catch (error) {
    logger.error('Error updating client status:', error);
  }
};

export const markCallEnded = (callSid) => {
  if (activeCallSid === callSid) {
    logger.info(`Call ${callSid} ended. Releasing lock.`);
    isCallActive = false;
    activeCallSid = null;
  }
};

const initiateCall = async (client) => {
  try {
    isCallActive = true;
    logger.info(`Initiating call to ${client.name} (${client.phone})`);

    const clientNumber = client.phone;

    // Generate Outbound TwiML inline
    const twiml = `
      <Response>
        <Connect>
          <Stream url="wss://${new URL(config.server.publicUrl).host}/voice/stream">
            <Parameter name="callerId" value="${clientNumber}" />
            <Parameter name="mode" value="outbound" />
          </Stream>
        </Connect>
      </Response>
    `;

    const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
    const call = await twilioClient.calls.create({
      twiml,
      to: clientNumber,
      from: config.twilio.phoneNumber,
      statusCallback: `${config.server.publicUrl}/voice/status-callback`,
      statusCallbackEvent: ['completed'],
      statusCallbackMethod: 'POST'
    });

    activeCallSid = call.sid;
    logger.info(`Call initiated. SID: ${activeCallSid}`);
    return true;
  } catch (error) {
    logger.error('Error initiating call:', error);
    isCallActive = false;
    activeCallSid = null;
    return false;
  }
};

const runDripTick = async () => {
  if (isCallActive) {
    // If call is active but operating hours ended, we don't start a new one, we wait for it to finish gracefully
    return;
  }

  if (!checkOperatingHours()) {
    return;
  }

  const pending = getPendingClient();
  if (!pending) {
    logger.info('No pending clients found. Drip cycle complete.');
    stopDripService();
    return;
  }

  const { client, index, clients } = pending;

  // Mark as CALLED immediately before executing call to prevent duplicates
  updateClientStatus(clients, index, 'CALLED');

  await initiateCall(client);
};

export const startDripService = () => {
  if (dripInterval) {
    logger.warn('Drip service already running.');
    return;
  }

  logger.info('Starting Smart Drip Service');
  dripInterval = setInterval(runDripTick, 30000); // Check every 30 seconds
  runDripTick(); // Run immediately on start
};

export const stopDripService = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Smart Drip Service stopped');
  }
};
