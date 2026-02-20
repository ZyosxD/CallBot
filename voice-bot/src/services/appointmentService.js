import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import { readJsonFile, writeJsonFile } from '../utils/fileLock.js';
import { sendSuccessEmail } from './emailService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LEADS_FILE = path.join(__dirname, '../data/leads.json');

export const createAppointment = async (data) => {
  try {
    const { name, company, verifiedPhone, callerId, date, time } = data;

    // Basic validation
    if (!name || !company || !verifiedPhone || !date || !time) {
      throw new Error('Missing required appointment details');
    }

    const lead = {
      id: Date.now(),
      name,
      company,
      verifiedPhone,
      callerId,
      date,
      time,
      status: 'SCHEDULED',
      createdAt: new Date().toISOString()
    };

    // Read existing leads
    const leads = await readJsonFile(LEADS_FILE);

    // Add new lead
    leads.push(lead);

    // Write back to file
    await writeJsonFile(LEADS_FILE, leads);

    logger.info(`Lead saved for ${company} (${name})`);

    // Send email
    await sendSuccessEmail(lead);
    logger.info(`Success email sent for ${company}`);

    return {
      success: true,
      message: `Appointment confirmed for ${name} at ${company}.`
    };

  } catch (error) {
    logger.error('Error creating appointment:', error);
    return {
      success: false,
      message: 'Failed to schedule appointment.'
    };
  }
};
