import fs from 'fs';
import path from 'path';
import twilio from 'twilio';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const clientsFilePath = path.resolve('src/data/clients.json');
let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const checkOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const hour = now.hour();
  const minute = now.minute();
  const time = hour + minute / 60;

  const isMorning = time >= 9.5 && time < 11.5; // 9:30 - 11:30
  const isAfternoon = time >= 14.5 && time < 15.5; // 14:30 - 15:30

  return isMorning || isAfternoon;
};

const processNextClient = async () => {
  if (isCallActive) {
    logger.info('A call is currently active. Waiting...');
    return;
  }

  if (!checkOperatingHours()) {
    logger.info('Outside of operating hours (Mountain Time). Waiting...');
    return;
  }

  try {
    const clientsData = fs.readFileSync(clientsFilePath, 'utf8');
    const clients = JSON.parse(clientsData);

    const clientIndex = clients.findIndex((c) => c.status === 'PENDING');

    if (clientIndex === -1) {
      logger.info('No pending clients found. Waiting...');
      return;
    }

    const client = clients[clientIndex];
    logger.info(`Initiating call to ${client.phone} (${client.name})...`);

    // Mark as CALLED immediately to avoid duplicates
    clients[clientIndex].status = 'CALLED';
    fs.writeFileSync(clientsFilePath, JSON.stringify(clients, null, 2));

    const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

    const host = config.server.publicUrl ? config.server.publicUrl.replace(/^https?:\/\//, '') : 'localhost:3000';
    const streamUrl = `wss://${host}/voice/stream?mode=outbound&callerId=${encodeURIComponent(client.phone)}`;
    const twiml = `<Response><Connect><Stream url="${streamUrl}"/></Connect></Response>`;

    isCallActive = true;

    const call = await twilioClient.calls.create({
      twiml: twiml,
      to: client.phone,
      from: config.twilio.phoneNumber,
      statusCallback: `${config.server.publicUrl}/voice/inbound/status`,
    });

    activeCallSid = call.sid;
    logger.info(`Call initiated. SID: ${call.sid}`);
  } catch (error) {
    logger.error('Error processing next client in drip sequence:', error);
    isCallActive = false;
    activeCallSid = null;
  }
};

export const startDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
  }
  logger.info('Starting Smart Drip service...');
  dripInterval = setInterval(processNextClient, 10000); // Check every 10 seconds
  processNextClient(); // Trigger immediately
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
  }
  logger.info('Smart Drip service stopped.');
};

export const markCallEnded = (callSid) => {
  if (activeCallSid === callSid) {
    logger.info(`Releasing lock for call SID: ${callSid}`);
    isCallActive = false;
    activeCallSid = null;
  }
};
