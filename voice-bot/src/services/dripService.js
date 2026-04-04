import fs from 'fs/promises';
import path from 'path';
import twilio from 'twilio';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const clientsFilePath = path.join(process.cwd(), 'src', 'data', 'clients.json');
let dripInterval = null;
let isCallActive = false;
let activeCallSid = null;

const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

export const isWithinOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const hour = now.hour();
  const minute = now.minute();

  const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;

  const isMorning = timeStr >= '09:30' && timeStr < '11:30';
  const isAfternoon = timeStr >= '14:30' && timeStr < '15:30';

  return isMorning || isAfternoon;
};

export const markCallEnded = (callSid) => {
  if (callSid === activeCallSid) {
    logger.info(`Releasing lock for call ${callSid}`);
    isCallActive = false;
    activeCallSid = null;
  }
};

export const executeNextCall = async () => {
  if (isCallActive) {
    logger.debug('A call is currently active. Waiting...');
    return;
  }

  if (!isWithinOperatingHours()) {
    logger.debug('Outside of operating hours. Waiting...');
    return;
  }

  try {
    let clientsData = '[]';
    try {
      clientsData = await fs.readFile(clientsFilePath, 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }

    const clients = JSON.parse(clientsData);

    const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (nextClientIndex === -1) {
      logger.debug('No pending clients to call.');
      return;
    }

    const client = clients[nextClientIndex];
    logger.info(`Starting outbound call to ${client.phone}`);

    // Immediately mark as called locally
    clients[nextClientIndex].status = 'CALLED';
    await fs.writeFile(clientsFilePath, JSON.stringify(clients, null, 2));

    isCallActive = true;

    // Use absolute URL for the public hook
    const publicUrl = config.server.publicUrl;

    const call = await twilioClient.calls.create({
      to: client.phone,
      from: config.twilio.phoneNumber,
      twiml: `<Response><Connect><Stream url="wss://${publicUrl.replace(/^https?:\/\//, '')}/voice/stream?mode=outbound&amp;callerId=${encodeURIComponent(client.phone)}" /></Connect></Response>`,
      statusCallback: `${publicUrl}/voice/inbound/status`
      // Not restricting statusCallbackEvent to ensure we get all terminal callbacks
    });

    activeCallSid = call.sid;
    logger.info(`Call initiated with SID: ${call.sid}`);

  } catch (error) {
    logger.error('Error executing next outbound call:', error);
    isCallActive = false;
    activeCallSid = null;
  }
};

export const startDrip = () => {
  if (dripInterval) {
    logger.warn('Smart Drip is already running.');
    return;
  }

  logger.info('Starting Smart Drip service...');
  // Check every 30 seconds
  dripInterval = setInterval(executeNextCall, 30000);

  // Try one immediately
  executeNextCall();
};

export const stopDrip = () => {
  if (dripInterval) {
    logger.info('Stopping Smart Drip service...');
    clearInterval(dripInterval);
    dripInterval = null;
  }
};
