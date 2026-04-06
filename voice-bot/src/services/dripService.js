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

const clientsPath = path.resolve('src/data/clients.json');
let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

function isWithinOperatingHours() {
  const now = dayjs().tz('America/Denver');
  const timeStr = now.format('HH:mm');

  const isMorning = timeStr >= '09:30' && timeStr <= '11:30';
  const isAfternoon = timeStr >= '14:30' && timeStr <= '15:30';

  return isMorning || isAfternoon;
}

export async function processNextCall() {
  if (isCallActive) {
    logger.info('A call is currently active. Waiting...');
    return;
  }

  if (!isWithinOperatingHours()) {
    logger.info('Outside of operating hours (9:30-11:30 AM, 2:30-3:30 PM MT). Waiting...');
    return;
  }

  try {
    const clientsData = fs.readFileSync(clientsPath, 'utf8');
    const clients = JSON.parse(clientsData);

    const clientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (clientIndex === -1) {
      logger.info('No pending clients to call. Waiting...');
      return;
    }

    const client = clients[clientIndex];

    // Mark as CALLED immediately
    clients[clientIndex].status = 'CALLED';
    fs.writeFileSync(clientsPath, JSON.stringify(clients, null, 2));

    logger.info(`Initiating call to ${client.phone}...`);
    isCallActive = true;

    const call = await twilioClient.calls.create({
      to: client.phone,
      from: config.twilio.phoneNumber,
      twiml: `<Response><Connect><Stream url="wss://${new URL(config.server.publicUrl).host}/voice/stream?mode=outbound&callerId=${encodeURIComponent(client.phone)}" /></Connect></Response>`,
      statusCallback: `${config.server.publicUrl}/voice/outbound/status`,
      statusCallbackMethod: 'POST'
    });

    activeCallSid = call.sid;
    logger.info(`Call initiated. SID: ${call.sid}`);

  } catch (error) {
    logger.error('Error processing next call:', error);
    isCallActive = false;
    activeCallSid = null;
  }
}

export function startDrip() {
  if (dripInterval) return;
  logger.info('Starting Smart Drip engine...');
  dripInterval = setInterval(processNextCall, 10000); // Check every 10 seconds
}

export function stopDrip() {
  if (dripInterval) {
    logger.info('Stopping Smart Drip engine...');
    clearInterval(dripInterval);
    dripInterval = null;
  }
}

export function markCallEnded(callSid) {
  if (callSid === activeCallSid) {
    logger.info(`Releasing lock for Call SID: ${callSid}`);
    isCallActive = false;
    activeCallSid = null;
  } else if (!callSid) {
    // Force release if no sid provided
    logger.info('Force releasing call lock.');
    isCallActive = false;
    activeCallSid = null;
  }
}
