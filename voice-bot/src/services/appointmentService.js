import fs from 'fs';
import path from 'path';
import logger from '../utils/logger.js';
import { sendSuccessEmail } from './emailService.js';

const leadsFile = path.resolve('leads.json');

export const createAppointment = async (data) => {
  try {
    const { contactName, companyName, verifiedPhone, appointmentTime, callerId } = data;

    // Basic validation
    if (!contactName || !companyName || !verifiedPhone || !appointmentTime) {
      throw new Error('Missing required Trifecta details for appointment');
    }

    const appointment = {
      id: Date.now(),
      contactName,
      companyName,
      verifiedPhone,
      appointmentTime,
      callerId,
      status: 'confirmed',
      createdAt: new Date().toISOString()
    };

    let leads = [];
    if (fs.existsSync(leadsFile)) {
        try {
            leads = JSON.parse(fs.readFileSync(leadsFile, 'utf-8'));
        } catch (e) {
            logger.error('Error parsing leads.json:', e);
        }
    }

    leads.push(appointment);
    fs.writeFileSync(leadsFile, JSON.stringify(leads, null, 2));

    logger.info(`Appointment created for ${contactName} at ${companyName} on ${appointmentTime}`);

    // Trigger Success Email
    await sendSuccessEmail(appointment);

    return {
      success: true,
      message: `Technical Assessment confirmed for ${contactName} at ${companyName} on ${appointmentTime}.`
    };

  } catch (error) {
    logger.error('Error creating appointment:', error);
    return {
      success: false,
      message: 'Failed to create appointment.'
    };
  }
};
