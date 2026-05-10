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

const CLIENTS_FILE = path.join(process.cwd(), 'clients.json');
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

const getNextClient = async () => {
  try {
    const data = await fs.readFile(CLIENTS_FILE, 'utf8');
    const clients = JSON.parse(data);
    const pendingIndex = clients.findIndex(c => c.status === 'PENDING');

    if (pendingIndex !== -1) {
      const client = clients[pendingIndex];
      clients[pendingIndex].status = 'CALLED';
      await fs.writeFile(CLIENTS_FILE, JSON.stringify(clients, null, 2));
      return client;
    }
    return null;
  } catch (error) {
    logger.error('Error reading/updating clients.json:', error);
    return null;
  }
};

const initiateCall = async (client) => {
  try {
    isCallActive = true;
    const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

    logger.info(`Initiating outbound call to ${client.phone} (${client.name})`);

    const call = await twilioClient.calls.create({
      to: client.phone,
      from: config.twilio.phoneNumber,
      twiml: `<Response><Connect><Stream url="wss://${config.server.publicUrl ? config.server.publicUrl.replace(/^https?:\/\//, '') : 'localhost:3000'}/voice/stream"><Parameter name="callerId" value="${client.phone}"/><Parameter name="mode" value="outbound"/></Stream></Connect></Response>`,
      statusCallback: `${config.server.publicUrl}/voice/inbound/status`
    });

    activeCallSid = call.sid;
    logger.info(`Outbound call initiated. CallSid: ${activeCallSid}`);
  } catch (error) {
    logger.error('Error initiating outbound call:', error);
    isCallActive = false;
    activeCallSid = null;
  }
};

const dripTick = async () => {
  if (isCallActive) {
    logger.info('Drip engine: Call is currently active. Waiting...');
    return;
  }

  if (!checkTimeWindow()) {
    logger.info('Drip engine: Outside of designated calling hours. Waiting...');
    return;
  }

  const client = await getNextClient();
  if (client) {
    await initiateCall(client);
  } else {
    logger.info('Drip engine: No pending clients found. Waiting...');
  }
};

export const startDrip = () => {
  if (dripInterval) return;
  logger.info('Starting Smart Drip Engine...');
  // Poll every 10 seconds
  dripInterval = setInterval(dripTick, 10000);
  // Execute immediately once
  dripTick();
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Smart Drip Engine stopped.');
  }
};

export const markCallEnded = (callSid) => {
  if (activeCallSid === callSid) {
    logger.info(`Lock released for call ${callSid}`);
    isCallActive = false;
    activeCallSid = null;
  }
};
