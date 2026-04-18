import fs from 'fs/promises';
import path from 'path';
import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const clientsPath = path.resolve('src/data/clients.json');
let isCallActive = false;
export let activeCallSid = null;
let dripInterval = null;

const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

export const isWithinOperatingHours = () => {
  const denverTime = dayjs().tz('America/Denver');
  const hour = denverTime.hour();
  const minute = denverTime.minute();
  const timeInMinutes = hour * 60 + minute;

  // 9:30-11:30 = 9*60+30 (570) to 11*60+30 (690)
  // 14:30-15:30 = 14*60+30 (870) to 15*60+30 (930)
  const isMorning = timeInMinutes >= 570 && timeInMinutes <= 690;
  const isAfternoon = timeInMinutes >= 870 && timeInMinutes <= 930;

  return isMorning || isAfternoon;
};

export const markCallEnded = (callSid) => {
  if (activeCallSid === callSid || !callSid) {
    logger.info(`Releasing drip lock for callSid: ${callSid}`);
    isCallActive = false;
    activeCallSid = null;
  }
};

const makeCall = async (client) => {
  try {
    isCallActive = true;
    logger.info(`Starting outbound call to ${client.phone}`);

    const protocol = config.server.publicUrl?.startsWith('https') ? 'wss' : 'ws';
    const host = config.server.publicUrl?.replace(/^https?:\/\//, '') || 'localhost:3000';
    const streamUrl = `${protocol}://${host}/voice/stream`;

    const twiml = new twilio.twiml.VoiceResponse();
    const connect = twiml.connect();
    const stream = connect.stream({ url: streamUrl });
    stream.parameter({ name: 'mode', value: 'outbound' });
    stream.parameter({ name: 'callerId', value: client.phone });

    const call = await twilioClient.calls.create({
      twiml: twiml.toString(),
      to: client.phone,
      from: config.twilio.phoneNumber,
      // Do not restrict statusCallbackEvent to an array as per memory instructions
      statusCallback: `https://${host}/voice/inbound/status`,
    });

    activeCallSid = call.sid;
    logger.info(`Call initiated with SID: ${call.sid}`);

  } catch (error) {
    logger.error(`Error making call to ${client.phone}: ${error.message}`);
    markCallEnded(null);
  }
};

const pollClients = async () => {
  if (isCallActive) return;

  if (!isWithinOperatingHours()) {
    // Keep cron alive, but do not call.
    return;
  }

  try {
    const data = await fs.readFile(clientsPath, 'utf-8');
    const clients = JSON.parse(data);

    const pendingIndex = clients.findIndex(c => c.status === 'PENDING');
    if (pendingIndex === -1) {
      // No clients to call
      return;
    }

    const nextClient = clients[pendingIndex];
    // Immediately mark as CALLED before initiating call to avoid duplicates
    clients[pendingIndex].status = 'CALLED';
    await fs.writeFile(clientsPath, JSON.stringify(clients, null, 2), 'utf-8');

    await makeCall(nextClient);

  } catch (error) {
    logger.error(`Error in Smart Drip polling loop: ${error.message}`);
  }
};

export const startDrip = () => {
  if (dripInterval) return;
  logger.info('Smart Drip Engine started.');
  // Poll every 15 seconds
  dripInterval = setInterval(pollClients, 15000);
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Smart Drip Engine stopped.');
  }
};
