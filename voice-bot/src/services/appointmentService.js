import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import { sendSuccessEmail, sendReportEmail } from './emailService.js';
import { withLock } from '../utils/fileLock.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../data');
const LEADS_FILE = path.join(DATA_DIR, 'leads.json');
const INTERACTIONS_FILE = path.join(DATA_DIR, 'interactions.json');

export const scheduleAppointment = async (data) => {
  try {
    const { name, company, phone, datetime, notes } = data;

    if (!name || !company || !phone || !datetime) {
      throw new Error('Missing required appointment details');
    }

    const lead = {
      id: Date.now(),
      name,
      company,
      phone,
      datetime,
      notes: notes || '',
      createdAt: new Date().toISOString()
    };

    // Append to leads.json with lock
    await withLock(LEADS_FILE, async () => {
      const leadsData = await fs.readFile(LEADS_FILE, 'utf-8').catch(() => '[]');
      const leads = JSON.parse(leadsData);
      leads.push(lead);
      await fs.writeFile(LEADS_FILE, JSON.stringify(leads, null, 2));
    });

    logger.info(`Lead scheduled: ${name} from ${company}`);

    // Send email
    await sendSuccessEmail({
        name,
        company,
        phone,
        datetime,
        notes,
        callerId: data.callerId // Passed from controller/service
    });

    return {
      success: true,
      message: `Appointment scheduled for ${name} at ${datetime}.`,
      lead
    };

  } catch (error) {
    logger.error('Error scheduling appointment:', error);
    return {
      success: false,
      message: 'Failed to schedule appointment.'
    };
  }
};

export const reportInteraction = async (data) => {
  try {
    const { outcome, notes, callerId } = data;

    const interaction = {
      id: Date.now(),
      outcome,
      notes: notes || '',
      callerId,
      createdAt: new Date().toISOString()
    };

    // Append to interactions.json with lock
    await withLock(INTERACTIONS_FILE, async () => {
      const interactionsData = await fs.readFile(INTERACTIONS_FILE, 'utf-8').catch(() => '[]');
      const interactions = JSON.parse(interactionsData);
      interactions.push(interaction);
      await fs.writeFile(INTERACTIONS_FILE, JSON.stringify(interactions, null, 2));
    });

    logger.info(`Interaction reported: ${outcome} for ${callerId}`);

    // Send email
    await sendReportEmail({
        outcome,
        notes,
        callerId,
        phone: callerId
    });

    return {
      success: true,
      message: `Interaction reported: ${outcome}.`
    };

  } catch (error) {
    logger.error('Error reporting interaction:', error);
    return {
      success: false,
      message: 'Failed to report interaction.'
    };
  }
};
