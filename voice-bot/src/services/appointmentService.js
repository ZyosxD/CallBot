import fs from 'fs';
import path from 'path';
import logger from '../utils/logger.js';
import { sendSuccessEmail } from './emailService.js';

const leadsPath = path.resolve('leads.json');

const ensureLeadsFile = () => {
  if (!fs.existsSync(leadsPath)) {
    fs.writeFileSync(leadsPath, JSON.stringify([]));
  }
};

export const createAppointment = async (data) => {
  try {
    const { contactName, companyName, verifiedPhone, exactTime, originalCallerId } = data;

    // The Trifecta Validation
    if (!contactName || !companyName || !verifiedPhone || !exactTime) {
      throw new Error('Missing required appointment details (The Trifecta or Exact Time)');
    }

    ensureLeadsFile();
    const leads = JSON.parse(fs.readFileSync(leadsPath, 'utf-8'));

    const appointment = {
      id: Date.now(),
      contactName,
      companyName,
      verifiedPhone,
      exactTime,
      originalCallerId,
      status: 'confirmed',
      timestamp: new Date().toISOString()
    };

    leads.push(appointment);
    fs.writeFileSync(leadsPath, JSON.stringify(leads, null, 2));

    logger.info(`Appointment created for ${contactName} at ${companyName} for ${exactTime}`);

    await sendSuccessEmail({
        contactName,
        companyName,
        verifiedPhone,
        exactTime,
        originalCallerId
    });

    return {
      success: true,
      message: `Technical Assessment confirmed for ${contactName} at ${exactTime}.`,
      appointment
    };

  } catch (error) {
    logger.error('Error creating appointment:', error);
    return {
      success: false,
      message: 'Failed to create appointment.'
    };
  }
};
