import fs from 'fs';
import path from 'path';
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

const clientsFile = path.resolve('src/data/clients.json');
let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const isWithinOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const morningStart = dayjs().tz('America/Denver').hour(9).minute(30).second(0);
  const morningEnd = dayjs().tz('America/Denver').hour(11).minute(30).second(0);
  const afternoonStart = dayjs().tz('America/Denver').hour(14).minute(30).second(0);
  const afternoonEnd = dayjs().tz('America/Denver').hour(15).minute(30).second(0);

  return now.isBetween(morningStart, morningEnd) || now.isBetween(afternoonStart, afternoonEnd);
};

export const startDrip = () => {
  if (dripInterval) return;
  logger.info('Starting Smart Drip Engine...');
  dripInterval = setInterval(processNextCall, 10000);
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Smart Drip Engine stopped.');
  }
};

export const markCallEnded = (callSid) => {
  if (callSid === activeCallSid) {
    logger.info(`Call ended: releasing lock for CallSid ${callSid}`);
    isCallActive = false;
    activeCallSid = null;
  }
};

const processNextCall = async () => {
  if (!isWithinOperatingHours()) {
    logger.info('Outside operating hours. Waiting...');
    return;
  }

  if (isCallActive) {
    logger.info('Call currently active. Waiting...');
    return;
  }

  try {
    const data = JSON.parse(fs.readFileSync(clientsFile, 'utf8'));
    const pendingIndex = data.findIndex(c => c.status === 'PENDING');

    if (pendingIndex === -1) {
      logger.info('No pending clients found. Waiting...');
      return;
    }

    const client = data[pendingIndex];

    // Mark as called BEFORE dialing to prevent race conditions
    data[pendingIndex].status = 'CALLED';
    fs.writeFileSync(clientsFile, JSON.stringify(data, null, 2));

    const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
    isCallActive = true;

    logger.info(`Initiating call to ${client.phone}...`);

    const call = await twilioClient.calls.create({
      to: client.phone,
      from: config.twilio.phoneNumber,
      url: `${config.server.publicUrl}/voice/outbound?callerId=${encodeURIComponent(client.phone)}`,
      statusCallback: `${config.server.publicUrl}/voice/outbound/status`,
      // Do not restrict statusCallbackEvent to ensure we always get updates
    });

    activeCallSid = call.sid;
    logger.info(`Call initiated. SID: ${call.sid}`);

  } catch (error) {
    logger.error('Error in drip processing: ' + error);
    isCallActive = false;
    activeCallSid = null;
  }
};
