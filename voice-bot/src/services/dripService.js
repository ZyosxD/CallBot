import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import twilio from 'twilio';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import isBetween from 'dayjs/plugin/isBetween.js';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isBetween);
dayjs.extend(customParseFormat);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientsFilePath = path.join(__dirname, '../../clients.json');

let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

const isWithinOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const morningStart = dayjs().tz('America/Denver').hour(9).minute(30).second(0);
  const morningEnd = dayjs().tz('America/Denver').hour(11).minute(30).second(0);
  const afternoonStart = dayjs().tz('America/Denver').hour(14).minute(30).second(0);
  const afternoonEnd = dayjs().tz('America/Denver').hour(15).minute(30).second(0);

  return now.isBetween(morningStart, morningEnd) || now.isBetween(afternoonStart, afternoonEnd);
};

const getNextPendingClient = async () => {
  try {
    const data = await fs.readFile(clientsFilePath, 'utf8');
    const clients = JSON.parse(data);
    const index = clients.findIndex(client => client.status === 'PENDING');

    if (index !== -1) {
      return { client: clients[index], index, clients };
    }
    return null;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      logger.error('Error reading clients file:', error);
    }
    return null;
  }
};

const markClientAsCalled = async (clients, index) => {
  clients[index].status = 'CALLED';
  await fs.writeFile(clientsFilePath, JSON.stringify(clients, null, 2));
};

export const startDrip = () => {
  if (dripInterval) {
    logger.info('Drip service is already running.');
    return;
  }

  logger.info('Starting Smart Drip service.');
  dripInterval = setInterval(async () => {
    if (isCallActive) {
      return; // Wait for current call to finish
    }

    if (!isWithinOperatingHours()) {
      return; // Outside operating hours, just wait
    }

    const nextClientData = await getNextPendingClient();
    if (!nextClientData) {
      return; // No more pending clients
    }

    const { client, index, clients } = nextClientData;

    try {
      isCallActive = true;
      logger.info(`Initiating outbound call to ${client.phone}`);

      const call = await twilioClient.calls.create({
        to: client.phone,
        from: config.twilio.phoneNumber,
        twiml: `<Response><Connect><Stream url="wss://${config.server.publicUrl}/voice/stream"><Parameter name="mode" value="outbound"/><Parameter name="callerId" value="${client.phone}"/></Stream></Connect></Response>`,
        statusCallback: `https://${config.server.publicUrl}/voice/inbound/status`
      });

      activeCallSid = call.sid;
      await markClientAsCalled(clients, index);
      logger.info(`Call initiated with SID: ${call.sid}`);

    } catch (error) {
      logger.error('Error initiating outbound call:', error);
      isCallActive = false; // Release lock on error
      activeCallSid = null;
    }
  }, 10000); // Check every 10 seconds
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
    logger.info(`Releasing lock for call SID: ${callSid}`);
    isCallActive = false;
    activeCallSid = null;
  }
};
