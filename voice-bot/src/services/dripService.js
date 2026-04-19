import twilio from 'twilio';
import fs from 'fs';
import path from 'path';
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

const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

const isWithinOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const hour = now.hour();
  const minute = now.minute();
  const timeNum = hour + minute / 60;

  // 9:30-11:30 or 14:30-15:30
  const isMorning = timeNum >= 9.5 && timeNum < 11.5;
  const isAfternoon = timeNum >= 14.5 && timeNum < 15.5;

  return isMorning || isAfternoon;
};

export const startDrip = () => {
  if (dripInterval) return;

  logger.info('Starting Smart Drip service...');

  dripInterval = setInterval(async () => {
    if (isCallActive) {
      logger.info('Call currently active, skipping this tick.');
      return;
    }

    if (!isWithinOperatingHours()) {
      logger.info('Outside of operating hours (MT). Waiting...');
      return;
    }

    try {
      const data = fs.readFileSync(clientsFile, 'utf8');
      const clients = JSON.parse(data);

      const pendingClientIndex = clients.findIndex(c => c.status === 'PENDING');
      if (pendingClientIndex === -1) {
        logger.info('No pending clients found. Waiting...');
        return;
      }

      isCallActive = true;
      const client = clients[pendingClientIndex];
      logger.info(`Initiating outbound call to ${client.name} (${client.phone})...`);

      // Mark as CALLED before making the call to avoid race conditions
      clients[pendingClientIndex].status = 'CALLED';
      fs.writeFileSync(clientsFile, JSON.stringify(clients, null, 2));

      // Initiate Twilio Call
      const call = await twilioClient.calls.create({
        to: client.phone,
        from: config.twilio.phoneNumber,
        twiml: `<Response>
                  <Connect>
                    <Stream url="wss://${new URL(config.server.publicUrl).host}/voice/stream">
                      <Parameter name="mode" value="outbound" />
                      <Parameter name="callerId" value="${client.phone}" />
                    </Stream>
                  </Connect>
                </Response>`,
        statusCallback: `${config.server.publicUrl}/voice/outbound/status`,
      });

      activeCallSid = call.sid;
      logger.info(`Outbound call initiated. CallSid: ${activeCallSid}`);

    } catch (error) {
      logger.error('Error in Smart Drip loop:', error);
      isCallActive = false;
      activeCallSid = null;
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

export const markCallEnded = async (callSid) => {
  if (callSid === activeCallSid) {
    logger.info(`Outbound call ${callSid} ended. Releasing lock.`);
    isCallActive = false;
    activeCallSid = null;
  }
};
