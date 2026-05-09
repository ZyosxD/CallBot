import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import twilio from 'twilio';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import isBetween from 'dayjs/plugin/isBetween.js';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isBetween);
dayjs.extend(customParseFormat);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientsFilePath = path.join(__dirname, '../../data/clients.json');

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

const getNextClient = async () => {
  try {
    const data = await fs.readFile(clientsFilePath, 'utf8');
    const clients = JSON.parse(data);
    const index = clients.findIndex((c) => c.status === 'PENDING');

    if (index !== -1) {
      const client = clients[index];
      clients[index].status = 'CALLED';
      await fs.writeFile(clientsFilePath, JSON.stringify(clients, null, 2));
      return client;
    }
    return null;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      logger.error('Error reading clients.json:', error);
    }
    return null;
  }
};

const executeCall = async (client) => {
  try {
    isCallActive = true;
    const twiml = `
      <Response>
        <Connect>
          <Stream url="${config.server.publicUrl.replace(/^https?:\/\//, 'wss://')}/voice/stream">
            <Parameter name="callerId" value="${client.phone}" />
            <Parameter name="mode" value="outbound" />
          </Stream>
        </Connect>
      </Response>
    `;

    const call = await twilioClient.calls.create({
      twiml: twiml,
      to: client.phone,
      from: config.twilio.phoneNumber,
      statusCallback: `${config.server.publicUrl}/voice/outbound/status`,
      statusCallbackMethod: 'POST'
    });

    activeCallSid = call.sid;
    logger.info(`Initiated outbound call to ${client.phone} (CallSid: ${call.sid})`);
  } catch (error) {
    logger.error('Error executing outbound call:', error);
    isCallActive = false;
    activeCallSid = null;
  }
};

export const processDripQueue = async () => {
  if (isCallActive) {
    logger.debug('Call currently active, skipping drip tick.');
    return;
  }

  if (!checkTimeWindow()) {
    logger.debug('Outside of Mountain Time calling window.');
    return;
  }

  const client = await getNextClient();
  if (client) {
    await executeCall(client);
  } else {
    logger.info('No pending clients found in the queue.');
  }
};

export const markCallEnded = (callSid) => {
  if (callSid && callSid === activeCallSid) {
    logger.info(`Marking outbound call ended for CallSid: ${callSid}`);
    isCallActive = false;
    activeCallSid = null;
  }
};

export const startDrip = () => {
  if (dripInterval) return;
  logger.info('Starting Smart Drip service.');
  dripInterval = setInterval(processDripQueue, 15000); // Check every 15 seconds
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Stopped Smart Drip service.');
  }
};