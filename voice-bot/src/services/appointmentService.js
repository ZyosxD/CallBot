import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import { sendSuccessEmail } from './emailService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const leadsFilePath = path.join(__dirname, '../../data/leads.json');

export const scheduleAppointment = async (appointmentData) => {
  try {
    const { contactName, companyName, verifiedPhone, exactTime, originalCallerId, notes } = appointmentData;

    let leads = [];
    try {
      const data = await fs.readFile(leadsFilePath, 'utf8');
      leads = JSON.parse(data);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.error('Error reading leads.json:', err);
      }
    }

    const newLead = {
      id: Date.now().toString(),
      contactName,
      companyName,
      verifiedPhone,
      exactTime,
      originalCallerId,
      notes,
      createdAt: new Date().toISOString()
    };

    leads.push(newLead);
    await fs.writeFile(leadsFilePath, JSON.stringify(leads, null, 2));
    logger.info(`Appointment scheduled for ${contactName} at ${companyName}`);

    await sendSuccessEmail(newLead);

    return { success: true, message: 'Appointment scheduled successfully.' };
  } catch (error) {
    logger.error('Error scheduling appointment:', error);
    return { success: false, message: 'Failed to schedule appointment.' };
  }
};