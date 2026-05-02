import fs from 'fs';
import path from 'path';
import twilio from 'twilio';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import isBetween from 'dayjs/plugin/isBetween.js';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isBetween);

let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const clientsFilePath = path.join(process.cwd(), 'src', 'data', 'clients.json');

const getClients = () => {
  try {
    const data = fs.readFileSync(clientsFilePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    logger.error('Error reading clients.json:', error);
    return [];
  }
};

const saveClients = (clients) => {
  try {
    fs.writeFileSync(clientsFilePath, JSON.stringify(clients, null, 2));
  } catch (error) {
    logger.error('Error writing to clients.json:', error);
  }
};

const isWithinOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const morningStart = now.hour(9).minute(30).second(0);
  const morningEnd = now.hour(11).minute(30).second(0);
  const afternoonStart = now.hour(14).minute(30).second(0);
  const afternoonEnd = now.hour(15).minute(30).second(0);

  return (
    now.isBetween(morningStart, morningEnd, null, '[)') ||
    now.isBetween(afternoonStart, afternoonEnd, null, '[)')
  );
};

const makeCall = async (client) => {
  const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
  const publicUrl = config.server.publicUrl;

  try {
    isCallActive = true;
    logger.info(`Initiating Smart Drip call to ${client.phone}`);

    // We pass the phone number as callerId to the TwiML via url params
    // and direction to let the handler know it's outbound API
    // However, since we might need the body.To later, let's just make the call and rely on the TwiML.

    const call = await twilioClient.calls.create({
      url: `${publicUrl}/voice/inbound`,
      to: client.phone,
      from: config.twilio.phoneNumber,
      statusCallback: `${publicUrl}/voice/inbound/status`,
      // Do not restrict statusCallbackEvent to ensure we get all terminal statuses
    });

    activeCallSid = call.sid;
    logger.info(`Call created with SID: ${activeCallSid}`);

    // Only mark as called after successfully creating the call
    const clients = getClients();
    const index = clients.findIndex((c) => c.phone === client.phone);
    if (index !== -1) {
      clients[index].status = 'CALLED';
      saveClients(clients);
    }
  } catch (error) {
    logger.error('Error creating Twilio call:', error);
    isCallActive = false;
    activeCallSid = null;
  }
};

export const startDrip = () => {
  logger.info('Starting Smart Drip engine...');
  if (dripInterval) clearInterval(dripInterval);

  dripInterval = setInterval(() => {
    if (isCallActive) {
      return;
    }

    if (!isWithinOperatingHours()) {
      return;
    }

    const clients = getClients();
    const pendingClient = clients.find((c) => c.status === 'PENDING');

    if (pendingClient) {
      makeCall(pendingClient);
    }
  }, 10000); // Check every 10 seconds
};

export const stopDrip = () => {
  logger.info('Stopping Smart Drip engine...');
  if (dripInterval) clearInterval(dripInterval);
};

export const markCallEnded = (callSid) => {
  if (activeCallSid === callSid) {
    logger.info(`Releasing outbound call lock for SID: ${callSid}`);
    isCallActive = false;
    activeCallSid = null;
  }
};
