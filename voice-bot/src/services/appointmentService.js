import fs from 'fs/promises';
import path from 'path';
import logger from '../utils/logger.js';
import { sendSuccessEmail } from './emailService.js';

const leadsFile = path.resolve('leads.json');

export const scheduleAppointment = async (data, callerId) => {
  try {
    const { name, company, verifiedPhone, time, notes } = data;

    // Validate the Trifecta + Time
    if (!name || !company || !verifiedPhone || !time) {
      throw new Error('Missing required information: name, company, verifiedPhone, or time');
    }

    const appointment = {
      id: Date.now(),
      name,
      company,
      verifiedPhone,
      time,
      notes: notes || '',
      callerId,
      createdAt: new Date().toISOString()
    };

    let leads = [];
    try {
      const fileData = await fs.readFile(leadsFile, 'utf8');
      leads = JSON.parse(fileData);
    } catch (e) {
      // If file doesn't exist or is empty, we start with an empty array
      leads = [];
    }

    leads.push(appointment);
    await fs.writeFile(leadsFile, JSON.stringify(leads, null, 2));

    logger.info(`Appointment created for ${name} at ${company} on ${time}`);

    // Trigger success email
    await sendSuccessEmail(appointment, callerId);

    return {
      success: true,
      message: `Appointment confirmed for ${name} on ${time}.`,
      appointment
    };

  } catch (error) {
    logger.error('Error scheduling appointment:', error);
    return {
      success: false,
      message: 'Failed to schedule appointment.'
    };
  }
};
