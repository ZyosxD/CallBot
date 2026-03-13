import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import twilio from 'twilio';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientsPath = path.join(__dirname, '../data/clients.json');

let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

const isWithinOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const hour = now.hour();
  const minute = now.minute();
  const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;

  const isMorning = timeStr >= '09:30' && timeStr <= '11:30';
  const isAfternoon = timeStr >= '14:30' && timeStr <= '15:30';

  return isMorning || isAfternoon;
};

const readClients = () => {
  try {
    if (!fs.existsSync(clientsPath)) {
      fs.writeFileSync(clientsPath, JSON.stringify([]));
      return [];
    }
    return JSON.parse(fs.readFileSync(clientsPath, 'utf8'));
  } catch (error) {
    logger.error('Error reading clients:', error);
    return [];
  }
};

const writeClients = (clients) => {
  try {
    fs.writeFileSync(clientsPath, JSON.stringify(clients, null, 2));
  } catch (error) {
    logger.error('Error writing clients:', error);
  }
};

const initiateOutboundCall = async (client) => {
  try {
    isCallActive = true;

    // Create inline TwiML ensuring mode=outbound and passing callerId (client phone)
    const twiml = new twilio.twiml.VoiceResponse();
    const connect = twiml.connect();
    const stream = connect.stream({
      url: `wss://${new URL(config.server.publicUrl).host}/voice/stream`,
    });
    stream.parameter({ name: 'callerId', value: client.phone });
    stream.parameter({ name: 'mode', value: 'outbound' });

    const call = await twilioClient.calls.create({
      twiml: twiml.toString(),
      to: client.phone,
      from: config.twilio.phoneNumber,
      statusCallback: `${config.server.publicUrl}/voice/status-callback`,
      statusCallbackEvent: ['completed'],
    });

    activeCallSid = call.sid;
    logger.info(`Outbound call initiated to ${client.phone}, CallSid: ${call.sid}`);

    // Update status to CALLED
    const clients = readClients();
    const index = clients.findIndex((c) => c.id == client.id);
    if (index !== -1) {
      clients[index].status = 'CALLED';
      writeClients(clients);
    }
  } catch (error) {
    isCallActive = false;
    activeCallSid = null;
    logger.error('Error initiating outbound call:', error);
  }
};

const processNextClient = async () => {
  if (isCallActive) return;

  if (!isWithinOperatingHours()) {
    // If we're out of operating hours but still running, ensure we don't start new calls
    // The stopDrip logic or external process manager handles complete shutdown,
    // but we can add an active check here.
    return;
  }

  const clients = readClients();
  const nextClient = clients.find((c) => c.status === 'PENDING');

  if (nextClient) {
    logger.info(`Found PENDING client: ${nextClient.phone}`);
    await initiateOutboundCall(nextClient);
  } else {
    // logger.info('No PENDING clients found.');
  }
};

export const startDrip = () => {
  if (dripInterval) return;
  logger.info('Drip Service activated. Checking queue every 15 seconds.');
  dripInterval = setInterval(processNextClient, 15000);
  processNextClient(); // Check immediately
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Drip Service stopped.');
  }
};

export const markCallEnded = (callSid) => {
  if (activeCallSid === callSid) {
    logger.info(`Active outbound call ${callSid} completed. Releasing lock.`);
    isCallActive = false;
    activeCallSid = null;
  }
};
