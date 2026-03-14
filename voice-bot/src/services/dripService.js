import fs from 'fs';
import path from 'path';
import twilio from 'twilio';
import { fileURLToPath } from 'url';
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

const checkOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const timeStr = now.format('HH:mm');

  const morningStart = '09:30';
  const morningEnd = '11:30';
  const afternoonStart = '14:30';
  const afternoonEnd = '15:30';

  if ((timeStr >= morningStart && timeStr <= morningEnd) ||
      (timeStr >= afternoonStart && timeStr <= afternoonEnd)) {
    return true;
  }
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

const writeClients = (clients) => {
  try {
    fs.writeFileSync(clientsFilePath, JSON.stringify(clients, null, 2));
  } catch (error) {
    logger.error('Error writing clients.json:', error);
  }
};

const makeCall = async (clientData) => {
  try {
    const client = twilio(config.twilio.accountSid, config.twilio.authToken);
    const twiml = `
      <Response>
        <Connect>
          <Stream url="wss://${config.server.publicUrl.replace(/^https?:\/\//, '')}/voice/stream">
            <Parameter name="callerId" value="${clientData.phone}" />
            <Parameter name="mode" value="outbound" />
          </Stream>
        </Connect>
      </Response>
    `;

    const call = await client.calls.create({
      twiml: twiml,
      to: clientData.phone,
      from: config.twilio.phoneNumber,
      statusCallback: `${config.server.publicUrl}/voice/status-callback`,
      statusCallbackEvent: ['completed'],
      statusCallbackMethod: 'POST'
    });

    activeCallSid = call.sid;
    isCallActive = true;
    logger.info(`Started outbound call to ${clientData.phone} (CallSid: ${activeCallSid})`);
  } catch (error) {
    logger.error('Error making Twilio call:', error);
    isCallActive = false;
    activeCallSid = null;
  }
};

export const runDripCycle = async () => {
  if (!checkOperatingHours()) {
    if (isCallActive && activeCallSid) {
        logger.info(`Out of operating hours. Ending active call: ${activeCallSid}`);
        try {
            const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
            await twilioClient.calls(activeCallSid).update({
                twiml: '<Response><Say>Thanks for your time, goodbye.</Say></Response>'
            });
        } catch (error) {
             logger.error('Failed to end active call gracefully out of hours:', error);
        }
    }
    return;
  }

  if (isCallActive) {
    return;
  }

  const clients = readClients();
  const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');

  if (nextClientIndex === -1) {
    logger.info('No pending clients left.');
    return;
  }

  const nextClient = clients[nextClientIndex];

  // Mark as called immediately before calling
  clients[nextClientIndex].status = 'CALLED';
  writeClients(clients);

  await makeCall(nextClient);
};

export const startDrip = () => {
  if (dripInterval) return;

  logger.info('Starting Smart Drip Engine');
  runDripCycle();
  dripInterval = setInterval(runDripCycle, 10000); // Check every 10 seconds
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Smart Drip Engine stopped');
  }
};

export const markCallEnded = (callSid) => {
  if (activeCallSid === callSid) {
    logger.info(`Call ${callSid} ended. Releasing lock.`);
    isCallActive = false;
    activeCallSid = null;
  }
};
