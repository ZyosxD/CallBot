import cron from 'node-cron';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { startDrip, stopDrip } from './dripService.js';
import logger from '../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const TIMEZONE = "America/Denver";

export const initScheduler = () => {
  logger.info('Initializing Scheduler...');

  // Morning Shift: 9:30 AM - 11:30 AM MT
  cron.schedule('30 9 * * *', () => {
    logger.info('Starting Morning Shift (9:30 AM MT)');
    startDrip();
  }, { timezone: TIMEZONE });

  cron.schedule('30 11 * * *', () => {
    logger.info('Ending Morning Shift (11:30 AM MT)');
    stopDrip();
  }, { timezone: TIMEZONE });

  // Afternoon Shift: 2:30 PM - 3:30 PM MT
  cron.schedule('30 14 * * *', () => {
    logger.info('Starting Afternoon Shift (2:30 PM MT)');
    startDrip();
  }, { timezone: TIMEZONE });

  cron.schedule('30 15 * * *', () => {
    logger.info('Ending Afternoon Shift (3:30 PM MT)');
    stopDrip();
  }, { timezone: TIMEZONE });

  checkWindowAndStart();
};

const checkWindowAndStart = () => {
    const now = dayjs().tz(TIMEZONE);

    // Define windows for today
    const morningStart = now.hour(9).minute(30).second(0);
    const morningEnd = now.hour(11).minute(30).second(0);
    const afternoonStart = now.hour(14).minute(30).second(0);
    const afternoonEnd = now.hour(15).minute(30).second(0);

    const isMorning = now.isAfter(morningStart) && now.isBefore(morningEnd);
    const isAfternoon = now.isAfter(afternoonStart) && now.isBefore(afternoonEnd);

    if (isMorning || isAfternoon) {
        logger.info(`Server started within operational hours (${now.format('HH:mm')} MT). Starting Drip.`);
        startDrip();
    } else {
        logger.info(`Server started outside operational hours (${now.format('HH:mm')} MT). Drip pending.`);
    }
};
