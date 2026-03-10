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
let twilioClient = null;

if (config.twilio.accountSid && config.twilio.authToken) {
  twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
}

const isWithinOperatingHours = () => {
  const nowInDenver = dayjs().tz('America/Denver');
  const timeStr = nowInDenver.format('HH:mm');

  const morningStart = '09:30';
  const morningEnd = '11:30';
  const afternoonStart = '14:30';
  const afternoonEnd = '15:30';

  if (timeStr >= morningStart && timeStr <= morningEnd) {
    return true;
  }
  if (timeStr >= afternoonStart && timeStr <= afternoonEnd) {
    return true;
  }
  return false;
};

const getPendingClient = () => {
  try {
    const clientsData = fs.readFileSync(clientsFilePath, 'utf8');
    const clients = JSON.parse(clientsData);
    return clients.find(client => client.status === 'PENDING');
  } catch (err) {
    logger.error('Error reading clients.json in drip service:', err);
    return null;
  }
};

const markClientCalled = (clientId) => {
  try {
    const clientsData = fs.readFileSync(clientsFilePath, 'utf8');
    const clients = JSON.parse(clientsData);

    const clientIndex = clients.findIndex(c => c.id == clientId);
    if (clientIndex !== -1) {
      clients[clientIndex].status = 'CALLED';
      fs.writeFileSync(clientsFilePath, JSON.stringify(clients, null, 2), 'utf8');
      return true;
    }
  } catch (err) {
    logger.error('Error updating clients.json in drip service:', err);
  }
  return false;
};

const makeOutboundCall = async (client) => {
  try {
    if (!twilioClient) {
      logger.error('Twilio client is not initialized');
      return;
    }

    const publicUrl = config.server.publicUrl;
    if (!publicUrl) {
      logger.error('PUBLIC_URL is required to generate TwiML for outbound calls');
      return;
    }

    // Build the inline TwiML for the outbound call
    const twimlResponse = new twilio.twiml.VoiceResponse();
    const connect = twimlResponse.connect();

    // We pass the callerId and mode via Stream parameters
    const stream = connect.stream({
      url: `wss://${publicUrl.replace(/^https?:\/\//, '')}/voice/stream`
    });
    stream.parameter({ name: 'callerId', value: client.phone });
    stream.parameter({ name: 'mode', value: 'outbound' });

    const twimlString = twimlResponse.toString();

    // The callback URL must end exactly with /voice/status-callback
    const call = await twilioClient.calls.create({
      twiml: twimlString,
      to: client.phone,
      from: config.twilio.phoneNumber,
      statusCallback: `${publicUrl}/voice/status-callback`,
      statusCallbackEvent: ['completed'],
      statusCallbackMethod: 'POST'
    });

    activeCallSid = call.sid;
    logger.info(`Initiated outbound call to ${client.phone}. CallSid: ${activeCallSid}`);
  } catch (error) {
    logger.error('Error initiating outbound call:', error);
    isCallActive = false; // Release lock on error
    activeCallSid = null;
  }
};

export const startDrip = () => {
  if (dripInterval) {
    return;
  }
  logger.info('Starting Smart Drip service...');

  dripInterval = setInterval(async () => {
    if (!isWithinOperatingHours()) {
      return; // Do nothing if outside hours
    }

    if (isCallActive) {
      return; // A call is already ongoing
    }

    const pendingClient = getPendingClient();
    if (!pendingClient) {
      // No pending clients
      return;
    }

    isCallActive = true;
    if (markClientCalled(pendingClient.id)) {
      await makeOutboundCall(pendingClient);
    } else {
      isCallActive = false; // Failed to mark, release lock
    }

  }, 10000); // Check every 10 seconds
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Smart Drip service stopped.');
  }
};

export const markCallEnded = (callSid) => {
  if (isCallActive && activeCallSid === callSid) {
    logger.info(`Outbound call ${callSid} ended. Releasing lock.`);
    isCallActive = false;
    activeCallSid = null;
  }
};
