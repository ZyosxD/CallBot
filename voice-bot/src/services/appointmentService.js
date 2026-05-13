import fs from 'fs';
import path from 'path';
import logger from '../utils/logger.js';
import { sendSuccessEmail } from './emailService.js';

const leadsFile = path.resolve('leads.json');

export const scheduleAppointment = async (data, callerId) => {
  try {
    const { contactName, companyName, verifiedPhone, exactTime } = data;

    if (!contactName || !companyName || !verifiedPhone || !exactTime) {
      throw new Error('Missing required appointment details');
    }

    const appointment = {
      id: Date.now(),
      contactName,
      companyName,
      verifiedPhone,
      exactTime,
      callerId,
      status: 'scheduled'
    };

    let leads = [];
    if (fs.existsSync(leadsFile)) {
      const fileData = fs.readFileSync(leadsFile, 'utf8');
      if (fileData) {
        leads = JSON.parse(fileData);
      }
    }

    leads.push(appointment);
    fs.writeFileSync(leadsFile, JSON.stringify(leads, null, 2), 'utf8');

    logger.info(`Appointment scheduled for ${contactName} from ${companyName} at ${exactTime}`);

    // Trigger success email
    await sendSuccessEmail(contactName, companyName, verifiedPhone, exactTime, callerId);

    return {
      success: true,
      message: `Appointment scheduled successfully for ${contactName}.`,
    };

  } catch (error) {
    logger.error('Error scheduling appointment:', error);
    return {
      success: false,
      message: 'Failed to schedule appointment.'
    };
  }
};