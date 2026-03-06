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
const clientsFilePath = path.join(__dirname, '../data/clients.json');

let isCallActive = false;
let dripInterval = null;

const checkOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const timeStr = now.format('HH:mm');

  // Morning: 9:30 AM - 11:30 AM
  const isMorning = timeStr >= '09:30' && timeStr < '11:30';
  // Afternoon: 2:30 PM - 3:30 PM
  const isAfternoon = timeStr >= '14:30' && timeStr < '15:30';

  return isMorning || isAfternoon;
};

const readClients = () => {
  try {
    const data = fs.readFileSync(clientsFilePath, 'utf-8');
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

const initiateCall = async (clientData) => {
  const client = twilio(config.twilio.accountSid, config.twilio.authToken);

  const twimlResponse = new twilio.twiml.VoiceResponse();
  const connect = twimlResponse.connect();
  const stream = connect.stream({
    url: `wss://${new URL(config.server.publicUrl).host}/voice/stream`,
  });
  stream.parameter({ name: 'mode', value: 'outbound' });
  stream.parameter({ name: 'callerId', value: clientData.phone });

  try {
    logger.info(`Initiating Smart Drip call to: ${clientData.phone}`);
    await client.calls.create({
      twiml: twimlResponse.toString(),
      to: clientData.phone,
      from: config.twilio.phoneNumber,
      statusCallback: `${config.server.publicUrl}/voice/status-callback`,
      statusCallbackEvent: ['completed', 'busy', 'no-answer', 'canceled', 'failed'],
    });
  } catch (error) {
    logger.error(`Failed to initiate call to ${clientData.phone}:`, error);
    isCallActive = false; // Release lock on error
  }
};

export const executeNextCall = async () => {
  if (isCallActive) {
    return;
  }

  if (!checkOperatingHours()) {
    return;
  }

  const clients = readClients();
  const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

  if (nextClientIndex === -1) {
    logger.info('Smart Drip: No more PENDING clients.');
    return;
  }

  // Lock and mark immediately
  isCallActive = true;
  clients[nextClientIndex].status = 'CALLED';
  saveClients(clients);

  const clientData = clients[nextClientIndex];
  await initiateCall(clientData);
};

export const onCallEnded = () => {
  logger.info('Call ended. Releasing lock.');
  isCallActive = false;
};

export const startDrip = () => {
  if (dripInterval) return;
  logger.info('Starting Smart Drip Engine...');
  // Check every 30 seconds
  dripInterval = setInterval(executeNextCall, 30000);
  executeNextCall(); // Fire immediately
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Stopped Smart Drip Engine.');
  }
};
