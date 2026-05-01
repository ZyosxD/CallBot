import fs from 'fs';
import path from 'path';
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

let dripInterval = null;
let isCallActive = false;
let activeCallSid = null;

const CLIENTS_FILE = path.join(process.cwd(), 'src', 'data', 'clients.json');

const isWithinOperatingHours = () => {
  const now = dayjs().tz('America/Denver');

  const morningStart = dayjs().tz('America/Denver').hour(9).minute(30).second(0);
  const morningEnd = dayjs().tz('America/Denver').hour(11).minute(30).second(0);

  const afternoonStart = dayjs().tz('America/Denver').hour(14).minute(30).second(0);
  const afternoonEnd = dayjs().tz('America/Denver').hour(15).minute(30).second(0);

  return now.isBetween(morningStart, morningEnd) || now.isBetween(afternoonStart, afternoonEnd);
};

const pollClients = async () => {
  if (isCallActive) {
    return;
  }

  if (!isWithinOperatingHours()) {
    return;
  }

  try {
    let clients = [];
    if (fs.existsSync(CLIENTS_FILE)) {
      clients = JSON.parse(fs.readFileSync(CLIENTS_FILE, 'utf-8'));
    }

    const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');
    if (nextClientIndex === -1) {
      return;
    }

    const client = clients[nextClientIndex];

    // Mark as CALLED before making the call to avoid race conditions
    clients[nextClientIndex].status = 'CALLED';
    fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));

    isCallActive = true;

    const clientPhone = client.phone;
    logger.info(`Smart Drip Engine: Initiating call to ${clientPhone}`);

    const clientTwilio = twilio(config.twilio.accountSid, config.twilio.authToken);

    const twimlUrl = `${config.server.publicUrl || 'http://localhost:' + config.server.port}/voice/inbound`;

    // Ensure statusCallback points to the fastify inbound status webhook
    const statusCallbackUrl = `${config.server.publicUrl || 'http://localhost:' + config.server.port}/voice/inbound/status`;

    const call = await clientTwilio.calls.create({
      url: twimlUrl,
      to: clientPhone,
      from: config.twilio.phoneNumber,
      statusCallback: statusCallbackUrl
    });

    activeCallSid = call.sid;
    logger.info(`Call initiated. SID: ${call.sid}`);
  } catch (error) {
    logger.error('Error in Smart Drip polling:', error);
    isCallActive = false;
    activeCallSid = null;
  }
};

export const startDrip = () => {
  if (dripInterval) return;
  logger.info('Starting Smart Drip Engine...');
  // Poll every 30 seconds
  dripInterval = setInterval(pollClients, 30 * 1000);
  pollClients(); // Trigger first run immediately
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Smart Drip Engine stopped.');
  }
};

export const markCallEnded = (callSid) => {
  if (callSid === activeCallSid || callSid === 'unknown') {
    isCallActive = false;
    activeCallSid = null;
    logger.info(`Call ${callSid} ended. Released dialing lock.`);
  }
};
