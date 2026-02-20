import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import { sendReport } from './emailService.js';
import { withLock } from '../utils/fileLock.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LEADS_FILE = path.join(__dirname, '../data/leads.json');
const INTERACTIONS_FILE = path.join(__dirname, '../data/interactions.json');

export const scheduleAppointment = async (data, callerId) => {
  try {
    logger.info(`Scheduling appointment for ${data.name}`);

    const appointment = {
      id: Date.now(),
      ...data,
      timestamp: new Date().toISOString()
    };

    await withLock(LEADS_FILE, async () => {
      const fileContent = await fs.readFile(LEADS_FILE, 'utf-8');
      const leads = JSON.parse(fileContent);
      leads.push(appointment);
      await fs.writeFile(LEADS_FILE, JSON.stringify(leads, null, 2));
    });

    // Send email
    await sendReport('success', appointment, callerId, data.phone);

    return { success: true, message: "Appointment scheduled successfully." };
  } catch (error) {
    logger.error('Error scheduling appointment:', error);
    return { success: false, message: "Failed to schedule appointment." };
  }
};

export const reportInteraction = async (data, callerId) => {
  try {
    logger.info(`Reporting interaction: ${data.outcome}`);

    const interaction = {
      id: Date.now(),
      ...data,
      callerId,
      timestamp: new Date().toISOString()
    };

    await withLock(INTERACTIONS_FILE, async () => {
        const fileContent = await fs.readFile(INTERACTIONS_FILE, 'utf-8');
        const interactions = JSON.parse(fileContent);
        interactions.push(interaction);
        await fs.writeFile(INTERACTIONS_FILE, JSON.stringify(interactions, null, 2));
    });

    // Send email
    await sendReport('report', interaction, callerId, null);

    return { success: true, message: "Interaction reported." };
  } catch (error) {
    logger.error('Error reporting interaction:', error);
    return { success: false, message: "Failed to report interaction." };
  }
};
