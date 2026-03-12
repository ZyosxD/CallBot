import fs from 'fs';
import path from 'path';
import twilio from 'twilio';
import { fileURLToPath } from 'url';
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

const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

export const isWithinOperatingHours = () => {
  const nowInDenver = dayjs().tz('America/Denver');
  const time = nowInDenver.format('HH:mm');
  const morningStart = '09:30';
  const morningEnd = '11:30';
  const afternoonStart = '14:30';
  const afternoonEnd = '15:30';

  const isMorning = time >= morningStart && time <= morningEnd;
  const isAfternoon = time >= afternoonStart && time <= afternoonEnd;

  return isMorning || isAfternoon;
};

const getNextClient = () => {
  try {
    const data = fs.readFileSync(CLIENTS_FILE, 'utf-8');
    const clients = JSON.parse(data);
    const client = clients.find((c) => c.status === 'PENDING');
    return client || null;
  } catch (error) {
    logger.error('Error reading clients file:', error);
    return null;
  }
};

const updateClientStatus = (clientId, status) => {
  try {
    const data = fs.readFileSync(CLIENTS_FILE, 'utf-8');
    const clients = JSON.parse(data);
    const clientIndex = clients.findIndex((c) => c.id === clientId);
    if (clientIndex !== -1) {
      clients[clientIndex].status = status;
      fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));
    }
  } catch (error) {
    logger.error('Error updating client status:', error);
  }
};

export const markCallEnded = (callSid) => {
  if (callSid === activeCallSid) {
    isCallActive = false;
    activeCallSid = null;
    logger.info(`Outbound call ended. Released lock for CallSid: ${callSid}`);
  }
};

export const processNextCall = async () => {
  if (isCallActive) {
    logger.info('A call is currently active. Waiting...');
    return;
  }

  if (!isWithinOperatingHours()) {
    logger.info('Outside of operating hours (Denver Time). Pausing drip...');
    return;
  }

  const client = getNextClient();
  if (!client) {
    logger.info('No pending clients found. Stopping Drip Service.');
    stopDrip();
    return;
  }

  isCallActive = true;
  logger.info(`Initiating outbound call to: ${client.phone} (ID: ${client.id})`);

  try {
    const call = await twilioClient.calls.create({
      to: client.phone,
      from: config.twilio.phoneNumber,
      statusCallback: `${config.server.publicUrl}/voice/status-callback`,
      statusCallbackEvent: ['completed'],
      // Passing callerId via query param for the callback or Twilio URL
      twiml: `<Response><Connect><Stream url="wss://${config.server.publicUrl.replace('https://', '')}/voice/stream"><Parameter name="callerId" value="${client.phone}" /><Parameter name="mode" value="outbound" /></Stream></Connect></Response>`
    });

    activeCallSid = call.sid;
    logger.info(`Call initiated. SID: ${call.sid}`);
    updateClientStatus(client.id, 'CALLED');
  } catch (error) {
    logger.error('Error initiating outbound call:', error);
    isCallActive = false;
  }
};

export const startDrip = () => {
  if (dripInterval) return;
  logger.info('Starting Smart Drip Service...');
  dripInterval = setInterval(processNextCall, 15000); // Check every 15s
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Smart Drip Service stopped.');
  }
};
