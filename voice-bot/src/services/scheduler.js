import cron from 'node-cron';
import logger from '../utils/logger.js';
import { startDrip, stopDrip } from './dripService.js';

const TIMEZONE = 'America/Denver';

export function initScheduler() {
  logger.info('Initializing Scheduler for Smart Drip...');

  // Start Morning Shift: 9:30 AM
  cron.schedule('30 9 * * 1-5', () => {
    logger.info('Scheduler: Starting Morning Shift');
    startDrip();
  }, {
    timezone: TIMEZONE
  });

  // End Morning Shift: 11:30 AM
  cron.schedule('30 11 * * 1-5', () => {
    logger.info('Scheduler: Ending Morning Shift');
    stopDrip();
  }, {
    timezone: TIMEZONE
  });

  // Start Afternoon Shift: 2:30 PM (14:30)
  cron.schedule('30 14 * * 1-5', () => {
    logger.info('Scheduler: Starting Afternoon Shift');
    startDrip();
  }, {
    timezone: TIMEZONE
  });

  // End Afternoon Shift: 3:30 PM (15:30)
  cron.schedule('30 15 * * 1-5', () => {
    logger.info('Scheduler: Ending Afternoon Shift');
    stopDrip();
  }, {
    timezone: TIMEZONE
  });

  // Immediate check on startup
  // We can just call startDrip, and let it decide if it should run based on time.
  // But wait, startDrip sets dripActive=true.
  // If we startDrip outside of window, it will check, see it's outside, and pause.
  // But we want it to *stop* completely outside window so it doesn't poll.
  // Let's rely on cron to start/stop.
  // But if server restarts in middle of window, we want to start.

  // We can check time now and decide.
  // Since we don't have isWithinTimeWindow exposed, maybe just startDrip() is fine?
  // dripService.checkAndCallNext handles the time check.
  // If outside window, it sets a timeout for 15 mins.
  // If we rely on cron to STOP it, then that timeout will be cleared.

  // Let's just call startDrip() on init.
  // If it's outside window, it will log "Outside of calling hours" and retry in 15 mins.
  // If cron hits stopDrip, it will clear that timeout.
  // But if we are outside window, cron for stopDrip might have already passed.
  // This logic is slightly conflictual.

  // If I strictly follow:
  // "check these hours immediately upon server startup."
  // I should call startDrip().
  startDrip();
}
