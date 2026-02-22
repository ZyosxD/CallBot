import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import logger from '../utils/logger.js';
import twilio from 'twilio';
import { config } from '../config/config.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENTS_FILE = path.join(__dirname, '../data/clients.json');
const VoiceResponse = twilio.twiml.VoiceResponse;

let isCallActive = false;
let dripInterval = null;

export const startDrip = () => {
  if (dripInterval) return;

  logger.info('Starting Smart Drip Service...');
  // Check every minute
  dripInterval = setInterval(runDripCycle, 60000);
  runDripCycle(); // Run immediately
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Stopped Smart Drip Service.');
  }
};

export const callEnded = () => {
  logger.info('Call ended. Releasing lock.');
  isCallActive = false;
};

const runDripCycle = async () => {
  if (isCallActive) {
    logger.info('Drip skipped: Call in progress.');
    return;
  }

  if (!checkSchedule()) {
    logger.info('Drip skipped: Outside operating hours (Mountain Time).');
    return;
  }

  await processNextLead();
};

const checkSchedule = () => {
  const now = dayjs().tz('America/Denver');
  const hour = now.hour();
  const minute = now.minute();

  // Morning: 09:30 - 11:30
  const isMorning = (hour === 9 && minute >= 30) || (hour === 10) || (hour === 11 && minute < 30);

  // Afternoon: 14:30 - 15:30 (2:30 PM - 3:30 PM)
  const isAfternoon = (hour === 14 && minute >= 30) || (hour === 15 && minute < 30);

  return isMorning || isAfternoon;
};

const processNextLead = async () => {
  try {
    const data = await fs.readFile(CLIENTS_FILE, 'utf-8');
    const clients = JSON.parse(data);

    const leadIndex = clients.findIndex(c => c.status === 'PENDING');

    if (leadIndex === -1) {
      logger.info('No pending leads found.');
      return;
    }

    const lead = clients[leadIndex];
    logger.info(`Processing lead: ${lead.name} (${lead.phone})`);

    // Mark as CALLED immediately
    clients[leadIndex].status = 'CALLED';
    clients[leadIndex].calledAt = new Date().toISOString();
    await fs.writeFile(CLIENTS_FILE, JSON.stringify(clients, null, 2));

    // Initiate Call
    isCallActive = true;
    try {
      await outboundCall(lead.phone, lead.id);
    } catch (callError) {
      logger.error('Failed to initiate outbound call:', callError);
      isCallActive = false; // Release lock if call initiation fails
    }

  } catch (error) {
    logger.error('Error processing lead:', error);
    isCallActive = false; // Release lock on error
  }
};

const outboundCall = async (phoneNumber, clientId) => {
  try {
    const client = twilio(config.twilio.accountSid, config.twilio.authToken);

    const response = new VoiceResponse();
    const connect = response.connect();
    // Using publicUrl from config for outbound calls initiated by server
    if (!config.server.publicUrl) {
        logger.warn('PUBLIC_URL not set in config. Drip service may fail.');
    }

    const host = config.server.publicUrl ? config.server.publicUrl.replace(/^https?:\/\//, '') : 'localhost:3000';
    const streamUrl = `wss://${host}/voice/stream`;
    const statusCallbackUrl = `https://${host}/voice/status-callback`;

    const stream = connect.stream({
      url: streamUrl
    });

    stream.parameter({
      name: 'mode',
      value: 'outbound'
    });
    stream.parameter({
      name: 'callerId',
      value: phoneNumber
    });

    logger.info(`Initiating outbound call to ${phoneNumber} with callback ${statusCallbackUrl}`);

    await client.calls.create({
      to: phoneNumber,
      from: config.twilio.phoneNumber,
      twiml: response.toString(),
      statusCallback: statusCallbackUrl,
      statusCallbackEvent: ['completed', 'busy', 'no-answer', 'failed']
    });

    logger.info(`Outbound call initiated to ${phoneNumber}`);

  } catch (error) {
    logger.error('Error initiating outbound call:', error);
    throw error;
  }
};
