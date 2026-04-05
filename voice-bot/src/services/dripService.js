import fs from 'fs';
import path from 'path';
import twilio from 'twilio';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';
import { fileURLToPath } from 'url';

dayjs.extend(utc);
dayjs.extend(timezone);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientsFilePath = path.join(__dirname, '../data/clients.json');

let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

export const isWithinOperatingHours = () => {
  const nowInDenver = dayjs().tz('America/Denver');
  const hour = nowInDenver.hour();
  const minute = nowInDenver.minute();
  const currentTime = hour + minute / 60;

  const isMorning = currentTime >= 9.5 && currentTime < 11.5; // 9:30-11:30
  const isAfternoon = currentTime >= 14.5 && currentTime < 15.5; // 14:30-15:30

  return isMorning || isAfternoon;
};

const getNextClient = () => {
  if (!fs.existsSync(clientsFilePath)) return null;
  const rawData = fs.readFileSync(clientsFilePath);
  let clients = [];
  try {
    clients = JSON.parse(rawData);
  } catch (e) {
    logger.error('Error parsing clients.json', e);
    return null;
  }

  const index = clients.findIndex(c => c.status === 'PENDING');
  if (index === -1) return null;

  const client = clients[index];
  clients[index].status = 'CALLED';

  fs.writeFileSync(clientsFilePath, JSON.stringify(clients, null, 2));
  return client;
};

const makeOutboundCall = async (client) => {
  isCallActive = true;
  logger.info(`Initiating Smart Drip call to ${client.phone}`);

  try {
    const statusCallbackUrl = `${config.server.publicUrl}/voice/inbound/status`;
    const callerIdQuery = encodeURIComponent(client.phone);

    const call = await twilioClient.calls.create({
      to: client.phone,
      from: config.twilio.phoneNumber,
      twiml: `<Response><Connect><Stream url="wss://${new URL(config.server.publicUrl).host}/voice/stream?callerId=${callerIdQuery}&amp;mode=outbound" /></Connect></Response>`,
      statusCallback: statusCallbackUrl
    });

    activeCallSid = call.sid;
    logger.info(`Outbound call initiated. CallSid: ${activeCallSid}`);
  } catch (error) {
    logger.error('Error making outbound call:', error);
    isCallActive = false;
    activeCallSid = null;
  }
};

const processDrip = async () => {
  if (isCallActive) {
    logger.debug('Call is currently active. Waiting...');
    return;
  }

  if (!isWithinOperatingHours()) {
    logger.debug('Outside operating hours. Waiting...');
    return;
  }

  const client = getNextClient();
  if (!client) {
    logger.debug('No pending clients found. Waiting...');
    return;
  }

  await makeOutboundCall(client);
};

export const startDrip = () => {
  if (dripInterval) return;
  logger.info('Starting Smart Drip engine...');
  dripInterval = setInterval(processDrip, 15000); // Check every 15 seconds
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Smart Drip engine stopped.');
  }
};

export const markCallEnded = (callSid) => {
  if (activeCallSid === callSid) {
    logger.info(`Call ended matching active outbound CallSid: ${callSid}. Releasing lock.`);
    isCallActive = false;
    activeCallSid = null;
  }
};
