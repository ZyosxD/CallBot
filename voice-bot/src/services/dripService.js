import fs from 'fs/promises';
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

const clientsFile = path.resolve('clients.json');
let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const checkTimeWindow = () => {
  const now = dayjs().tz('America/Denver');
  const morningStart = dayjs().tz('America/Denver').hour(9).minute(30).second(0);
  const morningEnd = dayjs().tz('America/Denver').hour(11).minute(30).second(0);
  const afternoonStart = dayjs().tz('America/Denver').hour(14).minute(30).second(0);
  const afternoonEnd = dayjs().tz('America/Denver').hour(15).minute(30).second(0);

  return now.isBetween(morningStart, morningEnd) || now.isBetween(afternoonStart, afternoonEnd);
};

export const markCallEnded = (callSid) => {
  if (activeCallSid === callSid) {
    logger.info(`Outbound call ${callSid} ended. Releasing lock.`);
    isCallActive = false;
    activeCallSid = null;
  }
};

const processNextClient = async () => {
  if (isCallActive) {
    return;
  }

  if (!checkTimeWindow()) {
    logger.info('Outside of smart drip operating hours (Mountain Time). Waiting...');
    return;
  }

  try {
    let clients = [];
    try {
      const fileContent = await fs.readFile(clientsFile, 'utf8');
      clients = JSON.parse(fileContent);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      return;
    }

    const pendingClientIndex = clients.findIndex(c => c.status === 'PENDING');
    if (pendingClientIndex === -1) {
      logger.info('No pending clients in clients.json.');
      return;
    }

    isCallActive = true;
    const client = clients[pendingClientIndex];
    logger.info(`Initiating smart drip call to: ${client.phone}`);

    const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
    const twimlUrl = `${config.server.publicUrl}/voice/inbound`;

    const call = await twilioClient.calls.create({
      url: twimlUrl,
      to: client.phone,
      from: config.twilio.phoneNumber,
      // Pass client.phone as callerId via parameter by formatting the url or it will use To via webhook
      // Passing Direction=outbound-api in the body from webhook since it's outbound API call
      statusCallback: `${config.server.publicUrl}/voice/inbound/status`,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed', 'busy', 'failed', 'no-answer', 'canceled'],
      statusCallbackMethod: 'POST',
    });

    activeCallSid = call.sid;
    clients[pendingClientIndex].status = 'CALLED';
    await fs.writeFile(clientsFile, JSON.stringify(clients, null, 2));

    logger.info(`Call initiated. CallSid: ${call.sid}`);

  } catch (error) {
    logger.error('Error processing next client:', error);
    isCallActive = false;
    activeCallSid = null;
  }
};

export const startDrip = () => {
  if (dripInterval) return;

  if (!config.server.publicUrl || config.server.publicUrl.includes('localhost') && !config.server.publicUrl.includes('ngrok')) {
     logger.warn('Skipping smart drip: PUBLIC_URL not valid for Twilio callbacks');
     return;
  }

  logger.info('Starting Smart Drip Engine...');
  // Poll every 15 seconds
  dripInterval = setInterval(processNextClient, 15000);
  processNextClient();
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Smart Drip Engine stopped.');
  }
};
