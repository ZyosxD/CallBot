import fs from 'fs';
import path from 'path';
import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const clientsFile = path.resolve('src/data/clients.json');
let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

export const markCallEnded = (callSid) => {
  if (callSid && callSid === activeCallSid) {
    logger.info(`Outbound call ended. Releasing lock for CallSid: ${callSid}`);
    isCallActive = false;
    activeCallSid = null;
  }
};

const isWithinOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const hour = now.hour();
  const minute = now.minute();
  const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;

  const isMorning = timeStr >= '09:30' && timeStr < '11:30';
  const isAfternoon = timeStr >= '14:30' && timeStr < '15:30';

  return isMorning || isAfternoon;
};

const executeNextCall = async () => {
  if (isCallActive) {
    return; // Wait for the active call to finish
  }

  if (!isWithinOperatingHours()) {
    logger.info('Outside operating hours. Waiting...');
    return;
  }

  let clients = [];
  try {
    clients = JSON.parse(fs.readFileSync(clientsFile, 'utf-8'));
  } catch (err) {
    logger.error('Error reading clients.json:', err);
    return;
  }

  const pendingClientIndex = clients.findIndex(c => c.status === 'PENDING');

  if (pendingClientIndex === -1) {
    logger.info('No PENDING clients found.');
    return;
  }

  const client = clients[pendingClientIndex];

  isCallActive = true;
  clients[pendingClientIndex].status = 'CALLED';
  fs.writeFileSync(clientsFile, JSON.stringify(clients, null, 2));

  try {
    logger.info(`Initiating Smart Drip call to ${client.phone}`);
    const call = await twilioClient.calls.create({
      to: client.phone,
      from: config.twilio.phoneNumber,
      twiml: `<Response><Connect><Stream url="wss://${config.server.publicUrl.replace(/^https?:\/\//, '')}/voice/stream"><Parameter name="mode" value="outbound" /><Parameter name="callerId" value="${client.phone}" /></Stream></Connect></Response>`,
      statusCallback: `${config.server.publicUrl}/voice/inbound/status`,
      // Do not pass statusCallbackEvent as an array as per memory
    });

    activeCallSid = call.sid;
    logger.info(`Call initiated. CallSid: ${call.sid}`);
  } catch (err) {
    logger.error(`Failed to initiate call to ${client.phone}:`, err);
    isCallActive = false;
    activeCallSid = null;
  }
};

export const startDrip = () => {
  if (!dripInterval) {
    logger.info('Starting Smart Drip Campaign polling...');
    // Poll every 30 seconds
    dripInterval = setInterval(executeNextCall, 30000);
    // Trigger first check immediately
    executeNextCall();
  }
};

export const stopDrip = () => {
  if (dripInterval) {
    logger.info('Stopping Smart Drip Campaign polling...');
    clearInterval(dripInterval);
    dripInterval = null;
  }
};
