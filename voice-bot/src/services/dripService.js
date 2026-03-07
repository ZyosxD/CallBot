import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLIENTS_FILE = path.join(__dirname, '../data/clients.json');

let isCallActive = false;
let dripInterval = null;

const checkOperatingHours = () => {
  const now = dayjs().tz('America/Denver');
  const timeStr = now.format('HH:mm');

  // 9:30 AM - 11:30 AM or 2:30 PM - 3:30 PM
  const isMorning = timeStr >= '09:30' && timeStr <= '11:30';
  const isAfternoon = timeStr >= '14:30' && timeStr <= '15:30';

  return isMorning || isAfternoon;
};

const makeOutboundCall = async (clientData) => {
  try {
    const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
    const twimlUrl = `${config.server.publicUrl}/voice/outbound-twiml?callerId=${encodeURIComponent(clientData.phone)}&mode=outbound`;

    logger.info(`Initiating call to ${clientData.phone} (${clientData.name})`);

    await twilioClient.calls.create({
      url: twimlUrl,
      to: clientData.phone,
      from: config.twilio.phoneNumber,
      statusCallback: `${config.server.publicUrl}/voice/status-callback`,
      statusCallbackEvent: ['completed']
    });

  } catch (error) {
    logger.error(`Failed to call ${clientData.phone}: `, error);
    isCallActive = false; // Reset lock on error
  }
};

const processNextClient = async () => {
  if (isCallActive) return;

  if (!checkOperatingHours()) {
      logger.info('Outside operating hours. Pausing Smart Drip.');
      return;
  }

  try {
    const fileContent = await fs.readFile(CLIENTS_FILE, 'utf-8');
    const clients = JSON.parse(fileContent);

    const targetIndex = clients.findIndex(c => c.status === 'PENDING');

    if (targetIndex !== -1) {
      isCallActive = true;
      const client = clients[targetIndex];

      // Mark as CALLED immediately
      clients[targetIndex].status = 'CALLED';
      await fs.writeFile(CLIENTS_FILE, JSON.stringify(clients, null, 2));

      await makeOutboundCall(client);
    } else {
        logger.info('No pending clients found in Smart Drip.');
        stopDrip();
    }
  } catch (error) {
    logger.error('Error processing clients in Smart Drip:', error);
    isCallActive = false;
  }
};

export const startDrip = () => {
  if (dripInterval) return;
  logger.info('Starting Smart Drip service...');

  // Check every minute
  dripInterval = setInterval(processNextClient, 60 * 1000);

  // Trigger first check immediately
  processNextClient();
};

export const stopDrip = () => {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
    logger.info('Smart Drip service stopped.');
  }
};

export const releaseCallLock = () => {
    logger.info('Call lock released for Smart Drip.');
    isCallActive = false;
};
