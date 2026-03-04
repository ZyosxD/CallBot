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
const clientsPath = path.join(__dirname, '../data/clients.json');

let isCallActive = false;
let dripInterval = null;

const checkOperatingHours = () => {
  const denverTime = dayjs().tz('America/Denver');
  const hour = denverTime.hour();
  const minute = denverTime.minute();

  // Morning: 9:30 AM - 11:30 AM
  const isMorning = (hour === 9 && minute >= 30) || (hour === 10) || (hour === 11 && minute <= 30);
  // Afternoon: 2:30 PM - 3:30 PM
  const isAfternoon = (hour === 14 && minute >= 30) || (hour === 15 && minute <= 30);

  return isMorning || isAfternoon;
};

const getNextClient = () => {
  try {
    const clientsData = fs.readFileSync(clientsPath, 'utf8');
    const clients = JSON.parse(clientsData);

    const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (nextClientIndex !== -1) {
      const client = clients[nextClientIndex];
      clients[nextClientIndex].status = 'CALLED';
      fs.writeFileSync(clientsPath, JSON.stringify(clients, null, 2));
      return client;
    }
  } catch (error) {
    logger.error('Error reading/writing clients data:', error);
  }
  return null;
};

const makeCall = async (client) => {
  if (isCallActive) return;

  if (!checkOperatingHours()) {
    logger.info('Outside operating hours. Pausing drip.');
    return;
  }

  isCallActive = true;
  logger.info(`Initiating outbound call to ${client.phone}`);

  try {
    const clientTwilio = twilio(config.twilio.accountSid, config.twilio.authToken);
    const serverUrl = config.server.publicUrl;

    const call = await clientTwilio.calls.create({
      url: `${serverUrl}/voice/outbound?callerId=${encodeURIComponent(client.phone)}`,
      to: client.phone,
      from: config.twilio.phoneNumber,
      statusCallback: `${serverUrl}/voice/status-callback`,
      statusCallbackEvent: ['completed', 'failed', 'busy', 'no-answer', 'canceled']
    });

    logger.info(`Call initiated. SID: ${call.sid}`);
  } catch (error) {
    logger.error('Error making call:', error);
    isCallActive = false; // Reset if it failed right away
  }
};

export const startDrip = () => {
  if (dripInterval) return;

  logger.info('Starting Drip Service');
  dripInterval = setInterval(() => {
    if (!isCallActive) {
      const nextClient = getNextClient();
      if (nextClient) {
        makeCall(nextClient);
      } else {
        logger.info('No pending clients left in the queue.');
      }
    }
  }, 10000); // Check every 10 seconds
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Drip Service stopped.');
  }
};

export const releaseCallLock = () => {
  isCallActive = false;
  logger.info('Call lock released.');
};

export const handleOutboundTwiML = (req, res) => {
  try {
    const response = new twilio.twiml.VoiceResponse();
    const connect = response.connect();

    // Add custom parameter for callerId so it can be extracted later
    const callerId = req.query.callerId || req.body.To;

    const stream = connect.stream({
      url: `wss://${req.headers.host}/voice/stream`,
    });

    stream.parameter({
      name: 'callerId',
      value: callerId
    });

    stream.parameter({
      name: 'mode',
      value: 'outbound'
    });

    res.type('text/xml');
    res.send(response.toString());
  } catch (error) {
    logger.error('Error generating outbound TwiML:', error);
    res.status(500).send('Internal Server Error');
  }
};
