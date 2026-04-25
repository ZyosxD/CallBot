import fs from 'fs';
import path from 'path';
import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import isBetween from 'dayjs/plugin/isBetween.js';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isBetween);
dayjs.extend(customParseFormat);

let isCallActive = false;
let activeCallSid = null;
let dripIntervalId = null;

const checkOperatingHours = () => {
  const now = dayjs().tz('America/Denver');

  const morningStart = dayjs().tz('America/Denver').hour(9).minute(30).second(0);
  const morningEnd = dayjs().tz('America/Denver').hour(11).minute(30).second(0);

  const afternoonStart = dayjs().tz('America/Denver').hour(14).minute(30).second(0);
  const afternoonEnd = dayjs().tz('America/Denver').hour(15).minute(30).second(0);

  return now.isBetween(morningStart, morningEnd) || now.isBetween(afternoonStart, afternoonEnd);
};

const pollForNextCall = async () => {
  if (isCallActive) {
    logger.info('Call is currently active. Skipping this tick.');
    return;
  }

  if (!checkOperatingHours()) {
    logger.info('Outside of operating hours (Mountain Time). Waiting...');
    return;
  }

  const clientsPath = path.join(process.cwd(), 'src', 'data', 'clients.json');
  let clients = [];
  try {
    clients = JSON.parse(fs.readFileSync(clientsPath, 'utf8'));
  } catch (error) {
    logger.error('Error reading clients.json:', error);
    return;
  }

  const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');
  if (nextClientIndex === -1) {
    logger.info('No pending clients to call.');
    return;
  }

  const client = clients[nextClientIndex];

  // Optimistic lock
  isCallActive = true;
  clients[nextClientIndex].status = 'CALLED';
  fs.writeFileSync(clientsPath, JSON.stringify(clients, null, 2));

  try {
    logger.info(`Initiating outbound call to ${client.phone}`);
    const clientTwilio = twilio(config.twilio.accountSid, config.twilio.authToken);

    // Generate outbound TwiML with Stream
    const twiml = new twilio.twiml.VoiceResponse();
    const connect = twiml.connect();
    const stream = connect.stream({
      url: `wss://${new URL(config.server.publicUrl).host}/voice/stream`,
    });

    stream.parameter({ name: 'callerId', value: client.phone });
    stream.parameter({ name: 'mode', value: 'outbound' });

    const call = await clientTwilio.calls.create({
      twiml: twiml.toString(),
      to: client.phone,
      from: config.twilio.phoneNumber,
      statusCallback: `${config.server.publicUrl}/voice/inbound/status`
    });

    activeCallSid = call.sid;
    logger.info(`Call initiated. SID: ${call.sid}`);

  } catch (error) {
    logger.error('Error initiating call:', error);
    // Release lock on error
    isCallActive = false;
    activeCallSid = null;
  }
};

export const startDrip = () => {
  if (!dripIntervalId) {
    logger.info('Starting Smart Drip Engine...');
    dripIntervalId = setInterval(pollForNextCall, 15000); // Poll every 15 seconds
  }
};

export const stopDrip = () => {
  if (dripIntervalId) {
    logger.info('Stopping Smart Drip Engine...');
    clearInterval(dripIntervalId);
    dripIntervalId = null;
  }
};

export const markCallEnded = (callSid) => {
  if (activeCallSid === callSid || activeCallSid === null) {
    logger.info(`Releasing lock for call ${callSid}`);
    isCallActive = false;
    activeCallSid = null;
  } else {
    logger.info(`Ignoring end for ${callSid} as it doesn't match active call ${activeCallSid}`);
  }
};
