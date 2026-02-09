import cron from 'node-cron';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { startDrip, stopDrip } from './dripService.js';
import logger from '../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const TIMEZONE = 'America/Denver';

const isWithinBusinessHours = () => {
  const now = dayjs().tz(TIMEZONE);
  const hour = now.hour();
  const minute = now.minute();

  // 9:30 - 11:30
  const isMorningSlot = (hour === 9 && minute >= 30) || (hour === 10) || (hour === 11 && minute < 30);

  // 14:30 - 15:30
  const isAfternoonSlot = (hour === 14 && minute >= 30) || (hour === 15 && minute < 30);

  return isMorningSlot || isAfternoonSlot;
};

export const initScheduler = () => {
  logger.info('Initializing Scheduler (Mountain Time)...');

  // Check immediately on startup
  if (isWithinBusinessHours()) {
    logger.info('Within business hours. Starting Drip Service immediately.');
    startDrip();
  } else {
    logger.info('Outside business hours. Drip Service will wait for next slot.');
  }

  // Schedule Start Times
  // 9:30 AM
  cron.schedule('30 9 * * *', () => {
    logger.info('Scheduler: Starting Morning Slot (9:30 AM)');
    startDrip();
  }, { timezone: TIMEZONE });

  // 2:30 PM
  cron.schedule('30 14 * * *', () => {
    logger.info('Scheduler: Starting Afternoon Slot (2:30 PM)');
    startDrip();
  }, { timezone: TIMEZONE });


  // Schedule Stop Times
  // 11:30 AM
  cron.schedule('30 11 * * *', () => {
    logger.info('Scheduler: Ending Morning Slot (11:30 AM)');
    stopDrip();
  }, { timezone: TIMEZONE });

  // 3:30 PM
  cron.schedule('30 15 * * *', () => {
    logger.info('Scheduler: Ending Afternoon Slot (3:30 PM)');
    stopDrip();
  }, { timezone: TIMEZONE });
};
