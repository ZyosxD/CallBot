import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import isBetween from 'dayjs/plugin/isBetween.js';
import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isBetween);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientsFilePath = path.join(__dirname, '../data/clients.json');

let isCallActive = false;
let dripInterval = null;
let currentCallSid = null;

const isWithinOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const startMorning = now.clone().hour(9).minute(30).second(0);
  const endMorning = now.clone().hour(11).minute(30).second(0);
  const startAfternoon = now.clone().hour(14).minute(30).second(0);
  const endAfternoon = now.clone().hour(15).minute(30).second(0);

  return now.isBetween(startMorning, endMorning) || now.isBetween(startAfternoon, endAfternoon);
};

const getPendingClient = () => {
  if (!fs.existsSync(clientsFilePath)) return null;
  const clients = JSON.parse(fs.readFileSync(clientsFilePath, 'utf8'));
  return clients.find((client) => client.status === 'PENDING');
};

const updateClientStatus = (clientId, status) => {
  if (!fs.existsSync(clientsFilePath)) return;
  const clients = JSON.parse(fs.readFileSync(clientsFilePath, 'utf8'));
  const clientIndex = clients.findIndex((c) => c.id == clientId);
  if (clientIndex !== -1) {
    clients[clientIndex].status = status;
    fs.writeFileSync(clientsFilePath, JSON.stringify(clients, null, 2));
  }
};

export const startDripService = () => {
  if (!config.server.publicUrl) {
    logger.warn('PUBLIC_URL is missing. Drip Service will not start.');
    return;
  }

  logger.info('Starting Smart Drip Service...');
  dripInterval = setInterval(async () => {
    if (isCallActive) {
      // End call if operating hours are over
      if (!isWithinOperatingHours() && currentCallSid) {
          logger.info(`Operating hours ended. Ending active call: ${currentCallSid}`);
          terminateActiveCall(currentCallSid);
      }
      return;
    }

    if (!isWithinOperatingHours()) {
      return;
    }

    const client = getPendingClient();
    if (!client) {
      logger.info('No pending clients found. Waiting...');
      return;
    }

    isCallActive = true;
    updateClientStatus(client.id, 'CALLED');

    try {
      logger.info(`Initiating outbound call to ${client.phone} (Client ID: ${client.id})`);
      const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

      const host = new URL(config.server.publicUrl).host;
      const twiml = `
        <Response>
          <Connect>
            <Stream url="wss://${host}/voice/stream">
              <Parameter name="mode" value="outbound"/>
              <Parameter name="callerId" value="${client.phone}"/>
            </Stream>
          </Connect>
        </Response>
      `;

      const call = await twilioClient.calls.create({
        twiml: twiml,
        to: client.phone,
        from: config.twilio.phoneNumber,
        statusCallback: `${config.server.publicUrl}/voice/status-callback`,
        statusCallbackEvent: ['completed', 'failed', 'busy', 'no-answer', 'canceled']
      });

      currentCallSid = call.sid;
      logger.info(`Outbound call initiated. Call SID: ${call.sid}`);
    } catch (error) {
      logger.error('Error initiating outbound call:', error);
      isCallActive = false; // Reset lock on error
      updateClientStatus(client.id, 'FAILED'); // Mark as failed to try next
    }
  }, 10000); // Check every 10 seconds
};

export const stopDripService = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Drip Service stopped.');
  }
};

export const handleCallEnded = (callSid) => {
    if (currentCallSid === callSid) {
        logger.info(`Call ${callSid} ended. Releasing lock.`);
        isCallActive = false;
        currentCallSid = null;
    }
};

const terminateActiveCall = async (callSid) => {
    try {
        const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
        await twilioClient.calls(callSid).update({
            twiml: `<Response><Say>Our office hours have ended. Thank you for your time.</Say><Hangup/></Response>`
        });
        isCallActive = false;
        currentCallSid = null;
    } catch (error) {
        logger.error(`Error terminating call ${callSid}:`, error);
    }
}