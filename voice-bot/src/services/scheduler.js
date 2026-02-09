import cron from 'node-cron';
import { checkAndRun, stopDrip, checkTimeWindow } from './dripService.js';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const TIMEZONE = config.drip.timezone;

export const initScheduler = () => {
  logger.info(`Initializing Scheduler in ${TIMEZONE}`);

  // Morning Window Start: 09:30
  cron.schedule('30 9 * * *', () => {
    logger.info('Scheduler: Morning window started.');
    checkAndRun();
  }, {
    timezone: TIMEZONE
  });

  // Morning Window End: 11:30
  cron.schedule('30 11 * * *', () => {
    logger.info('Scheduler: Morning window ended.');
    stopDrip();
  }, {
    timezone: TIMEZONE
  });

  // Afternoon Window Start: 14:30
  cron.schedule('30 14 * * *', () => {
    logger.info('Scheduler: Afternoon window started.');
    checkAndRun();
  }, {
    timezone: TIMEZONE
  });

  // Afternoon Window End: 15:30
  cron.schedule('30 15 * * *', () => {
    logger.info('Scheduler: Afternoon window ended.');
    stopDrip();
  }, {
    timezone: TIMEZONE
  });

  // Check on startup
  if (checkTimeWindow()) {
    logger.info('Scheduler: Within operating hours on startup.');
    checkAndRun();
  } else {
    logger.info('Scheduler: Outside operating hours on startup.');
  }
};
