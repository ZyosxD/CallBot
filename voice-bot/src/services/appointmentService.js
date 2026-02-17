import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LEADS_FILE = path.join(__dirname, '../data/leads.json');
const INTERACTIONS_FILE = path.join(__dirname, '../data/interactions.json');

export const scheduleAppointment = async (data) => {
  try {
    const { name, company, phone, confirmedPhone, appointmentTime, notes } = data;

    if (!name || !company || !appointmentTime) {
      throw new Error('Missing required appointment details');
    }

    const lead = {
      id: Date.now(),
      name,
      company,
      phone, // Caller ID
      confirmedPhone, // Verbal confirmation
      appointmentTime,
      notes,
      createdAt: new Date().toISOString()
    };

    let leads = [];
    try {
        if (fs.existsSync(LEADS_FILE)) {
            leads = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8'));
        }
    } catch (e) {
        logger.error('Error reading leads file, initializing empty array', e);
    }

    leads.push(lead);
    fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));

    await sendSuccessEmail(lead);

    logger.info(`Appointment scheduled for ${name} at ${appointmentTime}`);
    return { success: true, message: 'Appointment scheduled successfully.' };

  } catch (error) {
    logger.error('Error scheduling appointment:', error);
    return { success: false, message: 'Failed to schedule appointment.' };
  }
};

export const reportInteraction = async (data) => {
  try {
    const { name, phone, reason, transcript } = data;

    const interaction = {
        id: Date.now(),
        name,
        phone,
        reason,
        transcript,
        createdAt: new Date().toISOString()
    };

    let interactions = [];
    try {
        if (fs.existsSync(INTERACTIONS_FILE)) {
            interactions = JSON.parse(fs.readFileSync(INTERACTIONS_FILE, 'utf8'));
        }
    } catch (e) {
        logger.error('Error reading interactions file, initializing empty array', e);
    }

    interactions.push(interaction);
    fs.writeFileSync(INTERACTIONS_FILE, JSON.stringify(interactions, null, 2));

    await sendReportEmail(interaction);

    logger.info(`Interaction reported for ${phone}: ${reason}`);
    return { success: true, message: 'Interaction reported.' };

  } catch (error) {
    logger.error('Error reporting interaction:', error);
    return { success: false, message: 'Failed to report interaction.' };
  }
};
