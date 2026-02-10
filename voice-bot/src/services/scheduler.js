import cron from 'node-cron';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';
import { startDrip, stopDrip, makeNextCall } from './dripService.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const TIMEZONE = config.timezone || 'America/Denver';

export function initScheduler() {
  logger.info(`Initializing Scheduler in timezone: ${TIMEZONE}`);

  // Morning Window Start: 9:30 AM
  cron.schedule('30 9 * * 1-5', () => {
    logger.info('Morning window started (9:30 AM MT).');
    startDrip();
  }, { timezone: TIMEZONE });

  // Morning Window End: 11:30 AM
  cron.schedule('30 11 * * 1-5', () => {
    logger.info('Morning window ended (11:30 AM MT).');
    stopDrip();
  }, { timezone: TIMEZONE });

  // Afternoon Window Start: 2:30 PM (14:30)
  cron.schedule('30 14 * * 1-5', () => {
    logger.info('Afternoon window started (2:30 PM MT).');
    startDrip();
  }, { timezone: TIMEZONE });

  // Afternoon Window End: 3:30 PM (15:30)
  cron.schedule('30 15 * * 1-5', () => {
    logger.info('Afternoon window ended (3:30 PM MT).');
    stopDrip();
  }, { timezone: TIMEZONE });

  // Check on startup if we are currently inside a window
  checkCurrentTimeAndStart();
}

function checkCurrentTimeAndStart() {
  const now = dayjs().tz(TIMEZONE);
  const currentHour = now.hour();
  const currentMinute = now.minute();

  // Morning: 9:30 - 11:30
  const isMorning = (currentHour === 9 && currentMinute >= 30) || (currentHour === 10) || (currentHour === 11 && currentMinute < 30);

  // Afternoon: 14:30 - 15:30
  const isAfternoon = (currentHour === 14 && currentMinute >= 30) || (currentHour === 15 && currentMinute < 30);

  if (isMorning || isAfternoon) {
    logger.info(`Server started inside operating hours (${now.format('HH:mm')}). Starting Drip.`);
    startDrip();
  } else {
    logger.info(`Server started outside operating hours (${now.format('HH:mm')}). Drip is stopped.`);
    stopDrip();
  }
}
