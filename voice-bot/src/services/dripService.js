import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import fs from 'fs/promises';
import twilio from 'twilio';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const TIMEZONE = 'America/Denver'; // Mountain Time

let isCallActive = false;

export const checkAndCall = async () => {
  if (isCallActive) {
    logger.info('Drip: Call in progress, skipping.');
    return;
  }

  if (!isWithinHours()) {
    logger.debug('Drip: Outside operating hours.');
    return;
  }

  try {
    // Assuming running from root
    const clientsData = await fs.readFile('clients.json', 'utf8');
    const clients = JSON.parse(clientsData);

    const clientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (clientIndex === -1) {
      logger.info('Drip: No pending clients.');
      return;
    }

    const client = clients[clientIndex];
    logger.info(`Drip: Starting call for ${client.company} (${client.phone})`);

    // Update status immediately
    clients[clientIndex].status = 'CALLED';
    await fs.writeFile('clients.json', JSON.stringify(clients, null, 2));

    // Initiate Call
    isCallActive = true;
    const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

    // Ensure Public URL is set
    if (!config.server.publicUrl) {
        logger.error("Drip Error: PUBLIC_URL is not set.");
        isCallActive = false;
        return;
    }

    await twilioClient.calls.create({
      url: `${config.server.publicUrl}/voice/outbound-twiml`,
      to: client.phone,
      from: config.twilio.phoneNumber,
    });

    logger.info(`Drip: Call initiated to ${client.phone}`);

  } catch (error) {
    logger.error('Drip Error:', error);
    isCallActive = false; // Reset on error
  }
};

export const notifyCallEnded = () => {
  if (!isCallActive) return; // Already reset or wasn't active

  logger.info('Drip: Call ended. Waiting before next...');
  isCallActive = false;

  // Wait a bit then check again to chain calls
  setTimeout(() => {
    checkAndCall();
  }, 5000); // 5s wait before trying next
};

const isWithinHours = () => {
  const now = dayjs().tz(TIMEZONE);
  const hour = now.hour();
  const minute = now.minute();
  const day = now.day();

  // Skip weekends? Prompt doesn't specify, but usually business calls are Mon-Fri.
  // Prompt says "Mañana: 9:30...". I'll assume all days for now or Mon-Fri.
  // "Horario de Operación (Cron)" implies specific times.

  // 9:30 - 11:30
  const isMorning = (hour === 9 && minute >= 30) || (hour === 10) || (hour === 11 && minute < 30);

  // 14:30 - 15:30
  const isAfternoon = (hour === 14 && minute >= 30) || (hour === 15 && minute < 30);

  return isMorning || isAfternoon;
};
