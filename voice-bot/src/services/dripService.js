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
const clientsPath = path.join(__dirname, '../data/clients.json');

let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const checkOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const time = now.format('HH:mm');

  const isMorning = time >= '09:30' && time < '11:30';
  const isAfternoon = time >= '14:30' && time < '15:30';

  return isMorning || isAfternoon;
};

const readClients = () => {
  try {
    const data = fs.readFileSync(clientsPath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    if (err.code === 'ENOENT') {
      fs.writeFileSync(clientsPath, '[]', 'utf8');
      return [];
    }
    logger.error('Error reading clients.json:', err);
    return [];
  }
};

const writeClients = (clients) => {
  try {
    fs.writeFileSync(clientsPath, JSON.stringify(clients, null, 2), 'utf8');
  } catch (err) {
    logger.error('Error writing clients.json:', err);
  }
};

const executeNextCall = async () => {
  if (!checkOperatingHours()) {
    return;
  }

  if (isCallActive) {
    logger.info('Call in progress, skipping executeNextCall...');
    return;
  }

  const clients = readClients();
  const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

  if (nextClientIndex === -1) {
    logger.info('No pending clients found in Smart Drip.');
    return;
  }

  const client = clients[nextClientIndex];

  try {
    isCallActive = true;
    logger.info(`Initiating outbound call to ${client.phone}`);

    const clientTwiML = new twilio.twiml.VoiceResponse();
    const connect = clientTwiML.connect();
    const stream = connect.stream({
      url: `wss://${config.server.publicUrl.replace(/^https?:\/\//, '')}/voice/stream`
    });

    stream.parameter({ name: 'callerId', value: client.phone });
    stream.parameter({ name: 'mode', value: 'outbound' });

    const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
    const call = await twilioClient.calls.create({
      twiml: clientTwiML.toString(),
      to: client.phone,
      from: config.twilio.phoneNumber,
      statusCallback: `${config.server.publicUrl}/voice/status-callback`,
      statusCallbackMethod: 'POST'
    });

    activeCallSid = call.sid;
    logger.info(`Call initiated. SID: ${call.sid}`);

    clients[nextClientIndex].status = 'CALLED';
    writeClients(clients);

  } catch (err) {
    isCallActive = false;
    activeCallSid = null;
    logger.error('Error initiating outbound call:', err);
  }
};

export const startDrip = () => {
  if (dripInterval) return;

  if (!config.server.publicUrl) {
    logger.warn('Smart Drip disabled: no PUBLIC_URL configured.');
    return;
  }

  logger.info('Starting Smart Drip engine...');
  dripInterval = setInterval(executeNextCall, 15000); // Check every 15s
};

export const stopDrip = () => {
  logger.info('Stopping Smart Drip engine...');
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
  }
};

export const markCallEnded = (sid) => {
  if (sid && sid === activeCallSid) {
    logger.info(`Outbound call ended. SID: ${sid}`);
    isCallActive = false;
    activeCallSid = null;
  }
};
