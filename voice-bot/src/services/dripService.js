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

const clientsPath = path.resolve('clients.json');
let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const ensureClientsFile = () => {
  if (!fs.existsSync(clientsPath)) {
    fs.writeFileSync(clientsPath, JSON.stringify([]));
  }
};

const readClients = () => {
  ensureClientsFile();
  try {
    return JSON.parse(fs.readFileSync(clientsPath, 'utf-8'));
  } catch (error) {
    logger.error('Error reading clients file:', error);
    return [];
  }
};

const saveClients = (clients) => {
  try {
    fs.writeFileSync(clientsPath, JSON.stringify(clients, null, 2));
  } catch (error) {
    logger.error('Error saving clients file:', error);
  }
};

export const isWithinOperatingHours = () => {
  const now = dayjs().tz('America/Denver');

  const morningStart = now.hour(9).minute(30).second(0);
  const morningEnd = now.hour(11).minute(30).second(0);

  const afternoonStart = now.hour(14).minute(30).second(0); // 2:30 PM
  const afternoonEnd = now.hour(15).minute(30).second(0);   // 3:30 PM

  return now.isBetween(morningStart, morningEnd) || now.isBetween(afternoonStart, afternoonEnd);
};

export const markCallEnded = (callSid) => {
  if (activeCallSid === callSid || !activeCallSid) {
    logger.info(`Releasing call lock for CallSid: ${callSid}`);
    isCallActive = false;
    activeCallSid = null;
  } else {
    logger.info(`Ignoring call lock release for unmatching CallSid: ${callSid} (active: ${activeCallSid})`);
  }
};

export const executeDripCall = async () => {
  if (isCallActive) {
    return;
  }

  if (!isWithinOperatingHours()) {
    // Wait until operating hours
    return;
  }

  const clients = readClients();
  const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

  if (nextClientIndex === -1) {
    // No more pending clients
    return;
  }

  const client = clients[nextClientIndex];
  logger.info(`Starting drip call for client: ${client.phone}`);

  // Set lock immediately
  isCallActive = true;
  clients[nextClientIndex].status = 'CALLED';
  saveClients(clients);

  const clientPhone = client.phone;
  const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

  try {
    const call = await twilioClient.calls.create({
      twiml: `<Response><Connect><Stream url="wss://${new URL(config.server.publicUrl).host}/voice/stream"><Parameter name="callerId" value="${clientPhone}"/><Parameter name="mode" value="outbound"/></Stream></Connect></Response>`,
      to: clientPhone,
      from: config.twilio.phoneNumber,
      statusCallback: `${config.server.publicUrl}/voice/inbound/status`,
    });

    activeCallSid = call.sid;
    logger.info(`Drip call initiated: ${call.sid} for ${clientPhone}`);
  } catch (error) {
    logger.error('Error making drip call:', error);
    // Release lock on failure
    isCallActive = false;
    activeCallSid = null;
  }
};

export const startDrip = () => {
  if (!dripInterval) {
    logger.info('Starting Smart Drip Engine...');
    dripInterval = setInterval(executeDripCall, 10000); // Check every 10 seconds
  }
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Smart Drip Engine stopped.');
  }
};
