import fs from 'fs';
import path from 'path';
import twilio from 'twilio';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const clientsFile = path.resolve('src/data/clients.json');
let isCallActive = false;
let activeCallSid = null;
let dripInterval = null;

const isWithinOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const hour = now.hour();
  const minute = now.minute();

  const isMorning = (hour === 9 && minute >= 30) || hour === 10 || (hour === 11 && minute < 30);
  const isAfternoon = (hour === 14 && minute >= 30) || (hour === 15 && minute < 30);

  return isMorning || isAfternoon;
};

export const startDrip = () => {
  if (dripInterval) return;
  logger.info('Smart Drip Service started.');
  dripInterval = setInterval(processNextCall, 15000); // Check every 15 seconds
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Smart Drip Service stopped.');
  }
};

const processNextCall = async () => {
  if (isCallActive || !isWithinOperatingHours()) {
    return;
  }

  try {
    const clientsData = fs.readFileSync(clientsFile, 'utf8');
    const clients = JSON.parse(clientsData);

    const nextClientIndex = clients.findIndex(c => c.status === 'PENDING');
    if (nextClientIndex === -1) {
      return;
    }

    const client = clients[nextClientIndex];
    clients[nextClientIndex].status = 'CALLED';
    fs.writeFileSync(clientsFile, JSON.stringify(clients, null, 2));

    await initiateOutboundCall(client);
  } catch (error) {
    logger.error('Error processing next call:', error);
    isCallActive = false;
    activeCallSid = null;
  }
};

const initiateOutboundCall = async (client) => {
  try {
    isCallActive = true;
    const clientPhone = client.phone;
    logger.info(`Initiating outbound call to ${clientPhone}`);

    const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
    const twiml = `
      <Response>
        <Connect>
          <Stream url="wss://${config.server.publicUrl.replace(/^https?:\/\//, '')}/voice/stream">
            <Parameter name="callerId" value="${clientPhone}" />
            <Parameter name="mode" value="outbound" />
          </Stream>
        </Connect>
      </Response>
    `;

    const call = await twilioClient.calls.create({
      twiml: twiml,
      to: clientPhone,
      from: config.twilio.phoneNumber,
      statusCallback: `${config.server.publicUrl}/voice/status`,
    });

    activeCallSid = call.sid;
    logger.info(`Outbound call started with CallSid: ${activeCallSid}`);
  } catch (error) {
    logger.error('Error initiating outbound call:', error);
    isCallActive = false;
    activeCallSid = null;
  }
};

export const markCallEnded = (callSid) => {
  if (callSid === activeCallSid) {
    logger.info(`Call ended: ${callSid}`);
    isCallActive = false;
    activeCallSid = null;
  }
};
