import fs from 'fs/promises';
import path from 'path';
import logger from '../utils/logger.js';
import { sendSuccessEmail } from './emailService.js';

const leadsFile = path.resolve('leads.json');

export const createAppointment = async (data) => {
  try {
    const { contactName, companyName, verifiedPhone, appointmentTime, originalCallerId } = data;

    // Validate "The Trifecta" + Appointment Time
    if (!contactName || !companyName || !verifiedPhone || !appointmentTime) {
      throw new Error('Missing required appointment details. Must provide contactName, companyName, verifiedPhone, and appointmentTime.');
    }

    let leads = [];
    try {
      const fileContent = await fs.readFile(leadsFile, 'utf8');
      leads = JSON.parse(fileContent);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }

    const appointment = {
      id: Date.now(),
      contactName,
      companyName,
      verifiedPhone,
      appointmentTime,
      originalCallerId,
      status: 'confirmed'
    };

    leads.push(appointment);
    await fs.writeFile(leadsFile, JSON.stringify(leads, null, 2));

    logger.info(`Appointment created for ${contactName} at ${companyName} on ${appointmentTime}`);

    // Trigger success email
    await sendSuccessEmail(appointment);

    return {
      success: true,
      message: `Appointment confirmed for ${contactName} on ${appointmentTime}.`,
      appointment
    };

  } catch (error) {
    logger.error('Error creating appointment:', error);
    return {
      success: false,
      message: 'Failed to create appointment: ' + error.message
    };
  }
};
