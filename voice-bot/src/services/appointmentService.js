import fs from 'fs/promises';
import path from 'path';
import logger from '../utils/logger.js';
import { sendSuccessEmail } from './emailService.js';

const LEADS_FILE = path.join(process.cwd(), 'leads.json');

export const createAppointment = async (data, callerId) => {
  try {
    const { contactName, companyName, verifiedPhone, exactTime } = data;

    if (!contactName || !companyName || !verifiedPhone || !exactTime) {
      throw new Error('Missing required appointment details (Trifecta)');
    }

    const appointment = {
      id: Date.now(),
      contactName,
      companyName,
      verifiedPhone,
      exactTime,
      callerId,
      status: 'confirmed',
      createdAt: new Date().toISOString()
    };

    let leads = [];
    try {
      const fileData = await fs.readFile(LEADS_FILE, 'utf8');
      leads = JSON.parse(fileData);
    } catch (e) {
      // File doesn't exist or is invalid, create new array
    }

    leads.push(appointment);
    await fs.writeFile(LEADS_FILE, JSON.stringify(leads, null, 2));

    logger.info(`Appointment created for ${contactName} from ${companyName}`);

    // Send email without awaiting to not block
    sendSuccessEmail({
        name: contactName,
        company: companyName,
        verifiedPhone: verifiedPhone,
        time: exactTime
    }, callerId);

    return {
      success: true,
      message: `Appointment confirmed for ${contactName} at ${exactTime}.`,
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
