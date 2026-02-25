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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientsPath = path.join(__dirname, '../data/clients.json');

let isCallActive = false;

const loadClients = () => {
  try {
    const data = fs.readFileSync(clientsPath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    logger.error('Error reading clients.json:', error);
    return [];
  }
};

const saveClients = (clients) => {
  try {
    fs.writeFileSync(clientsPath, JSON.stringify(clients, null, 2));
  } catch (error) {
    logger.error('Error writing clients.json:', error);
  }
};

export const getClientByPhone = (phone) => {
  const clients = loadClients();
  // Phone in clients.json might be formatted differently, but assuming E.164
  return clients.find(c => c.phone === phone);
};

export const callEnded = () => {
  logger.info('Call ended. Releasing lock.');
  isCallActive = false;
};

export const startDrip = () => {
  logger.info('Starting Smart Drip Service...');

  // Check every minute
  setInterval(async () => {
    // If a call is already active, skip
    if (isCallActive) {
      // logger.info('Call in progress, skipping interval.');
      return;
    }

    const now = dayjs().tz('America/Denver');
    const currentHour = now.hour();
    const currentMinute = now.minute();

    // Morning: 9:30 - 11:30
    // 9:30 onwards: hour == 9 && minute >= 30
    // 10:00 - 10:59: hour == 10
    // 11:00 - 11:30: hour == 11 && minute < 30
    const isMorning = (currentHour === 9 && currentMinute >= 30) || (currentHour === 10) || (currentHour === 11 && currentMinute < 30);

    // Afternoon: 14:30 - 15:30 (2:30 PM - 3:30 PM)
    // 14:30 onwards: hour == 14 && minute >= 30
    // 15:00 - 15:30: hour == 15 && minute < 30
    const isAfternoon = (currentHour === 14 && currentMinute >= 30) || (currentHour === 15 && currentMinute < 30);

    if (!isMorning && !isAfternoon) {
      // logger.info('Outside operating hours.');
      return;
    }

    const clients = loadClients();
    const pendingClientIndex = clients.findIndex(c => c.status === 'PENDING');

    if (pendingClientIndex !== -1) {
      const client = clients[pendingClientIndex];
      logger.info(`Initiating call to ${client.name} (${client.phone})`);

      isCallActive = true;
      clients[pendingClientIndex].status = 'CALLED';
      saveClients(clients);

      try {
        const clientTwilio = twilio(config.twilio.accountSid, config.twilio.authToken);

        await clientTwilio.calls.create({
          url: `${config.server.publicUrl}/voice/inbound?direction=outbound`,
          to: client.phone,
          from: config.twilio.phoneNumber,
          statusCallback: `${config.server.publicUrl}/voice/status-callback`,
          statusCallbackEvent: ['completed', 'busy', 'no-answer', 'failed', 'canceled']
        });

      } catch (error) {
        logger.error('Error initiating call:', error);
        isCallActive = false; // Release lock on error
      }
    } else {
      // logger.info('No pending clients found.');
    }

  }, 60 * 1000);
};
