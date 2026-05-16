import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import { sendSuccessEmail } from './emailService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const leadsFilePath = path.join(__dirname, '../../leads.json');

export const scheduleAppointment = async (appointmentData) => {
  try {
    let leads = [];
    try {
      const data = await fs.readFile(leadsFilePath, 'utf8');
      leads = JSON.parse(data);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        throw err;
      }
    }

    const newLead = {
      ...appointmentData,
      createdAt: new Date().toISOString(),
    };

    leads.push(newLead);
    await fs.writeFile(leadsFilePath, JSON.stringify(leads, null, 2));

    logger.info(`Appointment scheduled for: ${appointmentData.companyName}`);

    await sendSuccessEmail(appointmentData);

    return { success: true, message: 'Appointment scheduled successfully' };
  } catch (error) {
    logger.error('Error scheduling appointment:', error);
    throw error;
  }
};
