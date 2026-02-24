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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENTS_FILE = path.join(__dirname, '../data/clients.json');

let isCallActive = false;
let currentCallSid = null;
let dripInterval = null;

const client = twilio(config.twilio.accountSid, config.twilio.authToken);

export const startDrip = () => {
  if (dripInterval) return;
  logger.info('Starting Smart Drip Engine...');

  // Check every minute
  dripInterval = setInterval(runDripCycle, 60000);
  runDripCycle(); // Run immediately
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
  }
};

export const callEnded = () => {
  isCallActive = false;
  currentCallSid = null;
  logger.info('Call ended. Drip engine ready for next call.');
};

const runDripCycle = async () => {
  try {
    if (!config.server.publicUrl) {
        logger.warn('PUBLIC_URL not set, Drip Service cannot start outbound calls.');
        return;
    }

    const now = dayjs().tz(config.timezone);
    const hour = now.hour();
    const minute = now.minute();

    // Morning: 9:30 - 11:30
    const isMorning = (hour === 9 && minute >= 30) || (hour === 10) || (hour === 11 && minute < 30);
    // Afternoon: 14:30 - 15:30 (2:30 PM - 3:30 PM)
    const isAfternoon = (hour === 14 && minute >= 30) || (hour === 15 && minute < 30);

    const isOperatingHours = isMorning || isAfternoon;

    if (!isOperatingHours) {
      if (isCallActive && currentCallSid) {
        logger.info('Operating hours ended. Terminating active call...');
        await client.calls(currentCallSid).update({ status: 'completed' });
        callEnded();
      }
      return;
    }

    if (isCallActive) {
      logger.info('Call in progress. Waiting...');
      return;
    }

    // Find next client
    if (!fs.existsSync(CLIENTS_FILE)) {
        logger.error('Clients file not found.');
        return;
    }
    const clientsData = fs.readFileSync(CLIENTS_FILE, 'utf8');
    const clients = JSON.parse(clientsData);

    const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (nextClientIndex === -1) {
      // logger.info('No pending clients found.'); // Less spammy
      return;
    }

    const nextClient = clients[nextClientIndex];
    logger.info(`Initiating call to ${nextClient.name} (${nextClient.phone})`);

    // Update status to CALLED
    clients[nextClientIndex].status = 'CALLED';
    clients[nextClientIndex].lastCalled = now.format();
    fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));

    // Make the call
    isCallActive = true;

    try {
        // Prepare URLs
        let publicUrl = config.server.publicUrl || '';
        publicUrl = publicUrl.replace(/^https?:\/\//, ''); // Strip protocol for WSS
        const wsUrl = `wss://${publicUrl}/voice/stream`;
        const callbackUrl = `https://${publicUrl}/voice/status-callback`;

        const VoiceResponse = twilio.twiml.VoiceResponse;
        const response = new VoiceResponse();
        const connect = response.connect();
        const stream = connect.stream({
            url: wsUrl
        });

        // Pass custom parameters for the stream
        // Note: Twilio <Parameter> must be inside <Stream>
        stream.parameter({ name: 'mode', value: 'outbound' });
        stream.parameter({ name: 'callerId', value: nextClient.phone });

        // We can pass the contact name too if we want the bot to know who they are calling
        // stream.parameter({ name: 'contactName', value: nextClient.name });

        const call = await client.calls.create({
            twiml: response.toString(),
            to: nextClient.phone,
            from: config.twilio.phoneNumber,
            statusCallback: callbackUrl,
            statusCallbackEvent: ['completed', 'busy', 'no-answer', 'failed']
        });
        currentCallSid = call.sid;
        logger.info(`Call started: ${call.sid}`);
    } catch (err) {
        logger.error('Error initiating call:', err);
        isCallActive = false;
        // Revert status? Or keep as CALLED? Spec says "Lo marca inmediatamente como CALLED".
        // If it failed, maybe we should log it but keep it as CALLED to avoid infinite loop on bad number.
    }

  } catch (error) {
    logger.error('Error in drip cycle:', error);
    isCallActive = false;
  }
};
