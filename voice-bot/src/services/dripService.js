import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import fs from 'fs';
import path from 'path';
import twilio from 'twilio';
import { fileURLToPath } from 'url';
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
  const denverTime = dayjs().tz('America/Denver');
  const h = denverTime.hour();
  const m = denverTime.minute();

  const isMorning = (h === 9 && m >= 30) || h === 10 || (h === 11 && m <= 30);
  const isAfternoon = h === 14 && m >= 30 || (h === 15 && m <= 30);

  return isMorning || isAfternoon;
};

const getPendingClient = () => {
  if (!fs.existsSync(clientsPath)) return null;
  const data = JSON.parse(fs.readFileSync(clientsPath, 'utf-8'));
  const clientIndex = data.findIndex(c => c.status === 'PENDING');
  if (clientIndex !== -1) {
    const client = data[clientIndex];
    data[clientIndex].status = 'CALLED';
    fs.writeFileSync(clientsPath, JSON.stringify(data, null, 2));
    return client;
  }
  return null;
};

const executeNextCall = async () => {
  if (isCallActive) return;

  if (!checkOperatingHours()) {
    logger.info('Outside operating hours for Smart Drip.');
    return;
  }

  const client = getPendingClient();
  if (!client) {
    logger.info('No PENDING clients found in queue.');
    return;
  }

  try {
    isCallActive = true;
    const clientPhone = client.phone;
    logger.info(`Initiating outbound call to ${clientPhone}`);

    const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
    const twiml = new twilio.twiml.VoiceResponse();
    const connect = twiml.connect();
    const stream = connect.stream({
      url: `wss://${config.server.publicUrl.replace(/^https?:\/\//, '')}/voice/stream`,
    });
    stream.parameter({ name: 'callerId', value: clientPhone });
    stream.parameter({ name: 'mode', value: 'outbound' });

    const call = await twilioClient.calls.create({
      twiml: twiml.toString(),
      to: clientPhone,
      from: config.twilio.phoneNumber,
      statusCallback: `${config.server.publicUrl}/voice/status-callback`,
      statusCallbackEvent: ['completed'],
      statusCallbackMethod: 'POST'
    });

    activeCallSid = call.sid;
    logger.info(`Outbound call initiated. SID: ${activeCallSid}`);

  } catch (error) {
    logger.error('Error initiating outbound call:', error);
    isCallActive = false;
    activeCallSid = null;
  }
};

export const startDrip = () => {
  if (!dripInterval) {
    dripInterval = setInterval(executeNextCall, 30000); // Check every 30s
  }
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
  }
};

export const markCallEnded = (sid) => {
  if (sid && sid === activeCallSid) {
    logger.info(`Releasing lock. Call ${sid} ended.`);
    isCallActive = false;
    activeCallSid = null;
  }
};
