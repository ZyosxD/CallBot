import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import twilio from 'twilio';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientsFilePath = path.join(__dirname, '../data/clients.json');

let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

// Twilio Client
const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

export const startDrip = () => {
  if (dripInterval) return;
  logger.info('Starting Smart Drip service (checking every 10s)');
  dripInterval = setInterval(processNextCall, 10000);
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Smart Drip service stopped.');
  }
};

export const markCallEnded = (CallSid) => {
  if (CallSid && activeCallSid === CallSid) {
    logger.info(`Outbound call ${CallSid} ended. Releasing lock.`);
    isCallActive = false;
    activeCallSid = null;
  }
};

const isWithinOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const hour = now.hour();
  const minute = now.minute();
  const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;

  const isMorning = timeStr >= '09:30' && timeStr <= '11:30';
  const isAfternoon = timeStr >= '14:30' && timeStr <= '15:30';

  return isMorning || isAfternoon;
};

const processNextCall = async () => {
  if (!isWithinOperatingHours()) {
    if (isCallActive && activeCallSid) {
      logger.info(`Out of operating hours. Terminating active call ${activeCallSid}`);
      try {
        const VoiceResponse = twilio.twiml.VoiceResponse;
        const response = new VoiceResponse();
        response.say('Our operating hours have ended. We will contact you later. Goodbye.');
        response.hangup();
        await twilioClient.calls(activeCallSid).update({ twiml: response.toString() });
      } catch (err) {
        logger.error(`Failed to terminate call ${activeCallSid}: ${err.message}`);
      }
    }
    return;
  }

  if (isCallActive) return;

  let clients = [];
  try {
    const data = fs.readFileSync(clientsFilePath, 'utf8');
    clients = JSON.parse(data);
  } catch (err) {
    logger.error(`Error reading clients.json: ${err.message}`);
    return;
  }

  const nextClient = clients.find(c => c.status === 'PENDING');
  if (!nextClient) {
    return;
  }

  logger.info(`Found PENDING client: ${nextClient.name} (${nextClient.phone}). Initiating call...`);

  // Mark as CALLED immediately
  nextClient.status = 'CALLED';
  try {
    fs.writeFileSync(clientsFilePath, JSON.stringify(clients, null, 2));
  } catch (err) {
    logger.error(`Error saving clients.json: ${err.message}`);
    return;
  }

  isCallActive = true;

  try {
    const publicUrl = config.server.publicUrl;
    // Generate inline TwiML for outbound call
    const VoiceResponse = twilio.twiml.VoiceResponse;
    const response = new VoiceResponse();
    const connect = response.connect();

    // We pass host without wss://
    const hostUrl = new URL(publicUrl);
    const stream = connect.stream({
      url: `wss://${hostUrl.host}/voice/stream`,
    });

    stream.parameter({ name: 'mode', value: 'outbound' });
    stream.parameter({ name: 'callerId', value: nextClient.phone });
    stream.parameter({ name: 'clientId', value: String(nextClient.id) });

    const twimlString = response.toString();

    const call = await twilioClient.calls.create({
      twiml: twimlString,
      to: nextClient.phone,
      from: config.twilio.phoneNumber,
      statusCallback: `${publicUrl}/voice/status-callback`,
      statusCallbackEvent: ['completed'],
      statusCallbackMethod: 'POST'
    });

    activeCallSid = call.sid;
    logger.info(`Outbound call initiated successfully. CallSid: ${activeCallSid}`);

  } catch (err) {
    logger.error(`Failed to create outbound call: ${err.message}`);
    isCallActive = false; // release lock if call fails to initiate
    activeCallSid = null;
  }
};
