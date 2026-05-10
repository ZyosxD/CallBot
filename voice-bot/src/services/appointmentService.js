import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import { sendSuccessEmail } from './emailService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LEADS_FILE = path.join(__dirname, '../../leads.json');

export const createAppointment = async (details, callerId) => {
  try {
    // Check for the Trifecta + Time
    if (!details.name || !details.companyName || !details.phone || !details.time) {
        throw new Error("Missing required fields for appointment (Trifecta + Time not met).");
    }

    let leads = [];
    try {
      const data = await fs.readFile(LEADS_FILE, 'utf-8');
      leads = JSON.parse(data);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // If file doesn't exist, we start with an empty array
    }

    const newLead = {
      ...details,
      callerId,
      timestamp: new Date().toISOString()
    };

    leads.push(newLead);
    await fs.writeFile(LEADS_FILE, JSON.stringify(leads, null, 2));

    logger.info(`Appointment created for ${details.name} at ${details.companyName}`);

    // Send green success email
    await sendSuccessEmail(details, callerId);

    return { status: 'success', message: 'Appointment created successfully' };
  } catch (error) {
    logger.error('Error creating appointment:', error);
    return { status: 'error', message: error.message };
  }
};

export const checkAvailability = async (date, time) => {
  // Placeholder logic, you might want to query a database or calendar API
  return true;
};
