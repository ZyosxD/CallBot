import cron from 'node-cron';
import logger from '../utils/logger.js';
import { makeNextCall, stopDrip } from './dripService.js';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const TIMEZONE = 'America/Denver';

export const startScheduler = () => {
  logger.info('Initializing scheduler...');

  // Morning Start: 9:30 AM
  cron.schedule('30 9 * * *', () => {
    logger.info('Scheduler: Starting Morning Drip (9:30 AM)');
    makeNextCall();
  }, { timezone: TIMEZONE });

  // Morning End: 11:30 AM
  cron.schedule('30 11 * * *', () => {
    logger.info('Scheduler: Stopping Morning Drip (11:30 AM)');
    stopDrip();
  }, { timezone: TIMEZONE });

  // Afternoon Start: 2:30 PM (14:30)
  cron.schedule('30 14 * * *', () => {
    logger.info('Scheduler: Starting Afternoon Drip (2:30 PM)');
    makeNextCall();
  }, { timezone: TIMEZONE });

  // Afternoon End: 3:30 PM (15:30)
  cron.schedule('30 15 * * *', () => {
    logger.info('Scheduler: Stopping Afternoon Drip (3:30 PM)');
    stopDrip();
  }, { timezone: TIMEZONE });

  // Check immediately on startup
  checkAndStartIfInWindow();
};

const checkAndStartIfInWindow = () => {
  const now = dayjs().tz(TIMEZONE);
  const hour = now.hour();
  const minute = now.minute();

  // Morning: 9:30 - 11:30
  // hour 9, min >= 30 OR hour 10 OR hour 11, min < 30 (WAIT, spec says 11:30. So up to 11:29?)
  // Actually, dripService.js implementation:
  // (hour === 9 && minute >= 30) || (hour === 10) || (hour === 11 && minute <= 30)
  // This means it runs AT 11:30. But cron stops at 11:30.
  // If we start at 11:30, and stop at 11:30... race condition?

  // Actually, spec says 9:30 - 11:30.
  // If we are AT 11:30, we should probably STOP, not start.

  // Let's reuse the logic from dripService if we could import it, but it is not exported.
  // I'll duplicate the logic for checking.

  const isMorning = (hour === 9 && minute >= 30) || (hour === 10) || (hour === 11 && minute < 30);
  const isAfternoon = (hour === 14 && minute >= 30) || (hour === 15 && minute < 30);

  if (isMorning || isAfternoon) {
    logger.info('Scheduler: Startup within operating hours. Kicking off drip.');
    makeNextCall();
  } else {
    logger.info('Scheduler: Startup outside operating hours. Waiting for next window.');
  }
};
