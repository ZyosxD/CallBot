import cron from 'node-cron';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { makeNextCall, stopDrip } from './dripService.js';
import logger from '../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const TIMEZONE = 'America/Denver';

const isWithinBusinessHours = () => {
  const now = dayjs().tz(TIMEZONE);
  const hour = now.hour();
  const minute = now.minute();

  // Morning: 9:30 - 11:30
  const isMorning = (hour === 9 && minute >= 30) || (hour === 10) || (hour === 11 && minute <= 30);

  // Afternoon: 14:30 - 15:30 (2:30 PM - 3:30 PM)
  const isAfternoon = (hour === 14 && minute >= 30) || (hour === 15 && minute <= 30);

  return isMorning || isAfternoon;
};

export const startScheduler = () => {
  logger.info('Starting Scheduler...');

  // Check immediately on startup
  if (isWithinBusinessHours()) {
    logger.info('Within business hours. Starting drip...');
    makeNextCall();
  } else {
      logger.info('Outside of business hours. Drip waiting...');
  }

  // Morning Window Start: 9:30 AM
  cron.schedule('30 9 * * 1-5', () => {
    logger.info('Morning shift started.');
    makeNextCall();
  }, { timezone: TIMEZONE });

  // Morning Window End: 11:30 AM
  cron.schedule('30 11 * * 1-5', () => {
    logger.info('Morning shift ended.');
    stopDrip();
  }, { timezone: TIMEZONE });

  // Afternoon Window Start: 2:30 PM
  cron.schedule('30 14 * * 1-5', () => {
    logger.info('Afternoon shift started.');
    makeNextCall();
  }, { timezone: TIMEZONE });

  // Afternoon Window End: 3:30 PM
  cron.schedule('30 15 * * 1-5', () => {
    logger.info('Afternoon shift ended.');
    stopDrip();
  }, { timezone: TIMEZONE });
};
