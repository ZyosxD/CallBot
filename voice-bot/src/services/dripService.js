import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import twilio from 'twilio';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import isBetween from 'dayjs/plugin/isBetween.js';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isBetween);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientsFilePath = path.join(__dirname, '../data/clients.json');

const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

export let isCallActive = false;
export let activeCallSid = null;
let dripInterval = null;

const checkTimeWindow = () => {
  const now = dayjs().tz('America/Denver');
  const morningStart = dayjs().tz('America/Denver').hour(9).minute(30).second(0);
  const morningEnd = dayjs().tz('America/Denver').hour(11).minute(30).second(0);

  const afternoonStart = dayjs().tz('America/Denver').hour(14).minute(30).second(0);
  const afternoonEnd = dayjs().tz('America/Denver').hour(15).minute(30).second(0);

  return now.isBetween(morningStart, morningEnd) || now.isBetween(afternoonStart, afternoonEnd);
};

const getNextPendingClient = () => {
  if (!fs.existsSync(clientsFilePath)) return null;
  const fileData = fs.readFileSync(clientsFilePath, 'utf8');
  let clients = JSON.parse(fileData);

  const clientIndex = clients.findIndex(c => c.status === 'PENDING');
  if (clientIndex !== -1) {
    const client = clients[clientIndex];
    clients[clientIndex].status = 'CALLED';
    fs.writeFileSync(clientsFilePath, JSON.stringify(clients, null, 2), 'utf8');
    return client;
  }
  return null;
};

export const startDrip = () => {
  if (dripInterval) {
    logger.info('Drip is already running.');
    return;
  }
  logger.info('Starting Smart Drip service...');

  dripInterval = setInterval(async () => {
    if (isCallActive) return;

    if (!checkTimeWindow()) {
        logger.info('Outside of dialing hours. Waiting...');
        return;
    }

    const client = getNextPendingClient();
    if (!client) {
      logger.info('No pending clients to call.');
      return;
    }

    try {
      isCallActive = true;
      logger.info(`Initiating outbound call to ${client.phone}`);

      const twiml = new twilio.twiml.VoiceResponse();
      const connect = twiml.connect();
      const stream = connect.stream({
        url: `wss://${new URL(config.server.publicUrl).host}/voice/stream`,
      });
      stream.parameter({ name: 'mode', value: 'outbound' });
      stream.parameter({ name: 'callerId', value: client.phone });

      const call = await twilioClient.calls.create({
        to: client.phone,
        from: config.twilio.phoneNumber,
        twiml: twiml.toString(),
        statusCallback: `${config.server.publicUrl}/voice/inbound/status`,
      });

      activeCallSid = call.sid;
      logger.info(`Call initiated, activeCallSid: ${activeCallSid}`);
    } catch (error) {
      logger.error('Error in drip campaign call initiation:', error);
      isCallActive = false;
      activeCallSid = null;
    }
  }, 10000);
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Smart Drip service stopped.');
  }
};

export const markCallEnded = (callSid) => {
  if (activeCallSid === callSid) {
    logger.info(`Releasing lock for callSid: ${callSid}`);
    isCallActive = false;
    activeCallSid = null;
  }
};
