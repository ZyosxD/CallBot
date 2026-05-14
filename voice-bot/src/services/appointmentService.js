import fs from 'fs/promises';
import path from 'path';
import logger from '../utils/logger.js';
import { sendSuccessEmail } from './emailService.js';

const LEADS_FILE = path.join(process.cwd(), 'leads.json');

export const createAppointment = async (data) => {
  try {
    const { name, company, verifiedPhone, callerId, appointmentTime, needs } = data;

    // Validate the Trifecta + Exact Time
    if (!name || !company || !verifiedPhone || !appointmentTime) {
      throw new Error('Missing required appointment details (Trifecta + Time)');
    }

    let leads = [];
    try {
      const fileData = await fs.readFile(LEADS_FILE, 'utf8');
      if (fileData) {
        leads = JSON.parse(fileData);
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
          throw err;
      }
    }

    const appointment = {
      id: Date.now(),
      name,
      company,
      verifiedPhone,
      callerId,
      appointmentTime,
      needs,
      status: 'confirmed',
      timestamp: new Date().toISOString()
    };

    leads.push(appointment);
    await fs.writeFile(LEADS_FILE, JSON.stringify(leads, null, 2), 'utf8');

    logger.info(`Appointment created for ${name} at ${company} for ${appointmentTime}`);

    await sendSuccessEmail(appointment);

    return {
      success: true,
      message: `Appointment confirmed for ${name} at ${appointmentTime}.`,
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

export const checkAvailability = async (date, time) => {
    // Basic mock availability
    return true;
};
