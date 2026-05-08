import fs from 'fs';
import path from 'path';
import twilio from 'twilio';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import isBetween from 'dayjs/plugin/isBetween.js';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isBetween);
dayjs.extend(customParseFormat);

const clientsPath = path.resolve('clients.json');
let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

const isWithinOperatingHours = () => {
  const nowDenver = dayjs().tz('America/Denver');
  const morningStart = dayjs.tz(`${nowDenver.format('YYYY-MM-DD')} 09:30`, 'YYYY-MM-DD HH:mm', 'America/Denver');
  const morningEnd = dayjs.tz(`${nowDenver.format('YYYY-MM-DD')} 11:30`, 'YYYY-MM-DD HH:mm', 'America/Denver');

  const afternoonStart = dayjs.tz(`${nowDenver.format('YYYY-MM-DD')} 14:30`, 'YYYY-MM-DD HH:mm', 'America/Denver');
  const afternoonEnd = dayjs.tz(`${nowDenver.format('YYYY-MM-DD')} 15:30`, 'YYYY-MM-DD HH:mm', 'America/Denver');

  return nowDenver.isBetween(morningStart, morningEnd) || nowDenver.isBetween(afternoonStart, afternoonEnd);
};

const readClients = () => {
  try {
    if (!fs.existsSync(clientsPath)) {
      fs.writeFileSync(clientsPath, JSON.stringify([], null, 2));
      return [];
    }
    const data = fs.readFileSync(clientsPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    logger.error('Error reading clients.json', error);
    return [];
  }
};

const writeClients = (clients) => {
  try {
    fs.writeFileSync(clientsPath, JSON.stringify(clients, null, 2));
  } catch (error) {
    logger.error('Error writing clients.json', error);
  }
};

const executeCall = async () => {
  if (isCallActive) {
    return;
  }

  if (!isWithinOperatingHours()) {
    logger.info('Outside operating hours. Waiting for the next tick.');
    return;
  }

  const clients = readClients();
  const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

  if (nextClientIndex === -1) {
    logger.info('No PENDING clients left.');
    return;
  }

  isCallActive = true;
  const clientToCall = clients[nextClientIndex];

  // Mark as CALLED before initiating to prevent duplicates
  clients[nextClientIndex].status = 'CALLED';
  writeClients(clients);

  logger.info(`Initiating outbound call to ${clientToCall.phone} (Client: ${clientToCall.name})`);

  try {
    const publicUrl = config.server.publicUrl;
    // Pass the client's phone number as the callerId to TwiML endpoint for report comparison
    const url = `${publicUrl}/voice/inbound`;

    // Passing callerId (client phone) via From parameter to the webhook?
    // Actually, TwiML needs it. Outbound webhooks get parameters differently. Wait, twilioClient.calls.create takes a URL or twiml.
    // If we use URL, we can append query params or configure the endpoint to handle it.

    // Instead of URL, we could use TwiML directly inline, but Twilio suggests not to use URL and TwiML simultaneously.
    // Memory says: "Do not use the url parameter in twilioClient.calls.create when passing twiml directly inline, to avoid Twilio API conflict errors."
    // Also says: "In Fastify callController.js, callerId and mode should be passed to the WebSocket via Twilio TwiML <Parameter> tags. Dynamically detect if a call is outbound by checking request.body?.Direction === 'outbound-api'."

    // So if we use `url: config.server.publicUrl + '/voice/inbound'`, Twilio will POST to it.
    // And Fastify will handle it. It will have Direction = outbound-api, To = client phone, From = Twilio number.
    // So the webhook is fine.

    const call = await twilioClient.calls.create({
      url: url,
      to: clientToCall.phone,
      from: config.twilio.phoneNumber,
      statusCallback: `${publicUrl}/voice/inbound/status`,
      // Memory says: "do not restrict statusCallbackEvent with an array to ensure Twilio status callbacks are always received and concurrency locks are properly released."
      // So no statusCallbackEvent array.
    });

    activeCallSid = call.sid;
    logger.info(`Call initiated. SID: ${activeCallSid}`);
  } catch (error) {
    logger.error('Error initiating outbound call:', error);
    isCallActive = false;
    activeCallSid = null;

    // revert status to PENDING on failure
    const currentClients = readClients();
    const revertIndex = currentClients.findIndex(c => c.phone === clientToCall.phone && c.status === 'CALLED');
    if (revertIndex !== -1) {
      currentClients[revertIndex].status = 'PENDING';
      writeClients(currentClients);
    }
  }
};

export const startDrip = () => {
  logger.info('Starting Smart Drip Engine');
  executeCall();
  // Check every 30 seconds
  dripInterval = setInterval(executeCall, 30000);
};

export const stopDrip = () => {
  logger.info('Stopping Smart Drip Engine');
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
  }
};

export const markCallEnded = (callSid) => {
  if (callSid === activeCallSid) {
    logger.info(`Releasing lock for Call SID: ${callSid}`);
    isCallActive = false;
    activeCallSid = null;
  }
};
