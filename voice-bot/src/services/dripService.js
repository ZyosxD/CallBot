import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientsFilePath = path.join(__dirname, '../data/clients.json');

let dripInterval = null;
let isCallActive = false;
let activeCallSid = null;

// Ensure Denver Time
const MT_TZ = 'America/Denver';

const isWithinOperatingHours = () => {
  const nowMT = dayjs().tz(MT_TZ);
  const timeStr = nowMT.format('HH:mm');

  // Morning: 9:30 AM - 11:30 AM
  if (timeStr >= '09:30' && timeStr <= '11:30') return true;
  // Afternoon: 2:30 PM - 3:30 PM
  if (timeStr >= '14:30' && timeStr <= '15:30') return true;

  return false;
};

const readClients = () => {
  try {
    const data = fs.readFileSync(clientsFilePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    logger.error('Error reading clients.json:', error);
    return [];
  }
};

const saveClients = (clients) => {
  try {
    fs.writeFileSync(clientsFilePath, JSON.stringify(clients, null, 2), 'utf-8');
  } catch (error) {
    logger.error('Error writing to clients.json:', error);
  }
};

const initiateOutboundCall = async (client) => {
  try {
    isCallActive = true;

    // We mark as CALLED immediately to avoid duplicates
    const clients = readClients();
    const clientIndex = clients.findIndex(c => c.id == client.id);
    if (clientIndex !== -1) {
      clients[clientIndex].status = 'CALLED';
      saveClients(clients);
    }

    const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

    // TwiML logic inline to handle Twilio VoiceResponse
    const VoiceResponse = twilio.twiml.VoiceResponse;
    const response = new VoiceResponse();
    const connect = response.connect();

    // Pass outbound mode and the client's phone as callerId to stream
    connect.stream({
      url: `wss://${new URL(config.server.publicUrl).host}/voice/stream`
    })
    .parameter({ name: 'callerId', value: client.phone })
    .parameter({ name: 'mode', value: 'outbound' });

    const twiml = response.toString();
    const statusCallbackUrl = `${config.server.publicUrl}/voice/status-callback`;

    const call = await twilioClient.calls.create({
      to: client.phone,
      from: config.twilio.phoneNumber,
      twiml: twiml,
      statusCallback: statusCallbackUrl,
      statusCallbackEvent: ['completed']
    });

    activeCallSid = call.sid;
    logger.info(`Outbound call initiated to ${client.phone} (Client ID: ${client.id}), CallSid: ${call.sid}`);
  } catch (error) {
    logger.error('Error initiating outbound call:', error);
    isCallActive = false;
    activeCallSid = null;
  }
};

const endActiveCallRespectfully = async () => {
  if (isCallActive && activeCallSid) {
    logger.info(`Operating hours ended. Attempting to gracefully end active call ${activeCallSid}`);
    try {
      const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
      const VoiceResponse = twilio.twiml.VoiceResponse;
      const response = new VoiceResponse();
      response.say('Thank you for speaking with 1Wire. Have a wonderful day. Goodbye.');
      response.hangup();

      await twilioClient.calls(activeCallSid).update({ twiml: response.toString() });
      logger.info(`Active call ${activeCallSid} redirected to graceful termination.`);
    } catch (error) {
      logger.error('Error ending active call respectfully:', error);
    }
  }
};

const dripCycle = async () => {
  if (!isWithinOperatingHours()) {
    logger.info('Outside of operating hours (Denver Time).');
    await endActiveCallRespectfully();
    return;
  }

  if (isCallActive) {
    logger.info(`A call is currently active (Sid: ${activeCallSid}). Waiting for it to complete.`);
    return;
  }

  const clients = readClients();
  const nextClient = clients.find(c => c.status === 'PENDING');

  if (nextClient) {
    logger.info(`Found pending client: ${nextClient.name} (${nextClient.phone}). Initiating call...`);
    await initiateOutboundCall(nextClient);
  } else {
    logger.info('No PENDING clients found in clients.json.');
  }
};

export const startDrip = () => {
  if (dripInterval) return;
  logger.info('Starting Smart Drip Engine...');
  // Run every 30 seconds
  dripInterval = setInterval(dripCycle, 30000);
  // Run immediately on start
  dripCycle();
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
    logger.info(`Call ${callSid} ended. Releasing lock.`);
    isCallActive = false;
    activeCallSid = null;
  }
};
