import fs from 'fs';
import path from 'path';
import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const clientsFilePath = path.join(process.cwd(), 'src', 'data', 'clients.json');
let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const loadClients = () => {
  try {
    const data = fs.readFileSync(clientsFilePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    logger.error('Error reading clients.json:', error);
    return [];
  }
};

const saveClients = (clients) => {
  try {
    fs.writeFileSync(clientsFilePath, JSON.stringify(clients, null, 2));
  } catch (error) {
    logger.error('Error writing clients.json:', error);
  }
};

const isWithinOperatingHours = () => {
  const denverTime = dayjs().tz('America/Denver');
  const timeStr = denverTime.format('HH:mm');
  const isMorning = timeStr >= '09:30' && timeStr < '11:30';
  const isAfternoon = timeStr >= '14:30' && timeStr < '15:30';
  return isMorning || isAfternoon;
};

export const processNextClient = async () => {
  if (isCallActive) {
    return;
  }

  if (!isWithinOperatingHours()) {
    logger.info('Outside operating hours for Smart Drip.');
    return;
  }

  const clients = loadClients();
  const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

  if (nextClientIndex === -1) {
    logger.info('No pending clients found.');
    return;
  }

  const client = clients[nextClientIndex];
  clients[nextClientIndex].status = 'CALLED';
  saveClients(clients);

  isCallActive = true;
  logger.info(`Initiating call to ${client.phone}`);

  try {
    const clientTwilio = twilio(config.twilio.accountSid, config.twilio.authToken);
    const serverUrl = config.server.publicUrl || `http://localhost:${config.server.port}`;

    // Pass the client phone as callerId to generate outbound TwiML URL
    const twimlUrl = `${serverUrl}/voice/outbound/twiml?callerId=${encodeURIComponent(client.phone)}`;

    const call = await clientTwilio.calls.create({
      url: twimlUrl,
      to: client.phone,
      from: config.twilio.phoneNumber,
      statusCallback: `${serverUrl}/voice/inbound/status`,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed', 'busy', 'failed', 'no-answer', 'canceled']
    });

    activeCallSid = call.sid;
    logger.info(`Call initiated. SID: ${call.sid}`);
  } catch (error) {
    logger.error('Error initiating call:', error);
    isCallActive = false;
    activeCallSid = null;
  }
};

export const markCallEnded = (callSid) => {
  if (activeCallSid === callSid) {
    logger.info(`Releasing lock for CallSid: ${callSid}`);
    isCallActive = false;
    activeCallSid = null;
  }
};

export const startDrip = () => {
  if (dripInterval) {
    return;
  }
  logger.info('Starting Smart Drip service.');
  dripInterval = setInterval(processNextClient, 10000); // Check every 10 seconds
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Stopped Smart Drip service.');
  }
};
