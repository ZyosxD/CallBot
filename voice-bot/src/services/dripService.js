import { getNextPendingClient, updateClientStatus } from './leadService.js';
import { initiateOutboundCall } from '../controllers/callController.js';
import { eventBus } from '../utils/events.js';
import logger from '../utils/logger.js';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const TIMEZONE = 'America/Denver'; // Mountain Time

let isDripRunning = false;
let activeCall = false;

export const startDrip = () => {
    if (isDripRunning) {
        logger.info('Drip service is already running.');
        return;
    }
    logger.info('Starting Drip Service');
    isDripRunning = true;
    triggerNextCall();
};

export const stopDrip = () => {
    logger.info('Stopping Drip Service');
    isDripRunning = false;
};

const checkTimeWindow = () => {
    const now = dayjs().tz(TIMEZONE);
    const time = now.format('HH:mm');

    const morningStart = '09:30';
    const morningEnd = '11:30';
    const afternoonStart = '14:30';
    const afternoonEnd = '15:30';

    const isMorning = time >= morningStart && time <= morningEnd;
    const isAfternoon = time >= afternoonStart && time <= afternoonEnd;

    return isMorning || isAfternoon;
};

const triggerNextCall = async () => {
    if (!isDripRunning) return;
    if (activeCall) return;

    if (!checkTimeWindow()) {
        logger.info('Outside of calling hours. Pausing drip.');
        isDripRunning = false;
        return;
    }

    const client = getNextPendingClient();
    if (!client) {
        logger.info('No pending clients found. Drip complete.');
        isDripRunning = false;
        return;
    }

    try {
        activeCall = true;
        updateClientStatus(client.phone, 'CALLED');
        logger.info(`Initiating drip call to ${client.name} (${client.phone})`);
        await initiateOutboundCall(client);
    } catch (error) {
        logger.error(`Failed to initiate drip call to ${client.phone}:`, error);
        activeCall = false;
        // Wait a bit before trying next one to avoid spamming on error
        setTimeout(triggerNextCall, 5000);
    }
};

// Listen for call completion
eventBus.on('callEnded', ({ callSid, clientId }) => {
    logger.info(`Drip call ended: ${callSid} for client ${clientId}`);
    activeCall = false;
    setTimeout(triggerNextCall, 1000);
});

export const checkAndResumeDrip = () => {
    if (checkTimeWindow() && !isDripRunning) {
        startDrip();
    }
};
