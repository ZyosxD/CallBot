import { appendJson } from '../utils/fileLock.js';
import { sendLeadEmail, sendReportEmail } from './emailService.js';
import logger from '../utils/logger.js';

export const scheduleAppointment = async (data, callSid, callerId) => {
  try {
    const lead = {
      id: Date.now(),
      callSid,
      ...data,
      timestamp: new Date().toISOString()
    };

    await appendJson('leads.json', lead);
    await sendLeadEmail(lead, callerId);

    logger.info(`Appointment scheduled for ${data.companyName}`);
    return { success: true, message: "Appointment scheduled successfully." };
  } catch (error) {
    logger.error('Error scheduling appointment:', error);
    return { success: false, message: "Failed to schedule appointment." };
  }
};

export const reportInteraction = async (data, callSid, callerId) => {
  try {
    const interaction = {
      id: Date.now(),
      callSid,
      callerId,
      ...data,
      timestamp: new Date().toISOString()
    };

    await appendJson('interactions.json', interaction);
    await sendReportEmail(interaction, callerId);

    logger.info(`Interaction reported: ${data.status}`);
    return { success: true, message: "Interaction reported successfully." };
  } catch (error) {
    logger.error('Error reporting interaction:', error);
    return { success: false, message: "Failed to report interaction." };
  }
};
