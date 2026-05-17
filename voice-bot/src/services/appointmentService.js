import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import { sendSuccessEmail } from './emailService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const leadsFilePath = path.join(__dirname, '../data/leads.json');

export const scheduleAppointment = async (appointmentData) => {
  try {
    let leads = [];
    if (fs.existsSync(leadsFilePath)) {
      const fileData = fs.readFileSync(leadsFilePath, 'utf8');
      leads = JSON.parse(fileData);
    }

    leads.push(appointmentData);
    fs.writeFileSync(leadsFilePath, JSON.stringify(leads, null, 2), 'utf8');

    await sendSuccessEmail(appointmentData);

    return { success: true, message: "Appointment scheduled and lead saved successfully." };
  } catch (error) {
    logger.error('Error scheduling appointment:', error);
    return { success: false, error: "Failed to schedule appointment." };
  }
};
