import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import { readJsonFile, writeJsonFile } from '../utils/fileLock.js';
import { sendReportEmail } from './emailService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const INTERACTIONS_FILE = path.join(__dirname, '../data/interactions.json');

export const reportInteraction = async (data) => {
  try {
    const { status, callerId, notes } = data;

    // Basic validation
    if (!status || !callerId) {
      throw new Error('Missing required interaction details');
    }

    const interaction = {
      id: Date.now(),
      status,
      callerId,
      notes,
      timestamp: new Date().toISOString()
    };

    // Read existing interactions
    const interactions = await readJsonFile(INTERACTIONS_FILE);

    // Add new interaction
    interactions.push(interaction);

    // Write back to file
    await writeJsonFile(INTERACTIONS_FILE, interactions);

    logger.info(`Interaction reported for ${callerId}: ${status}`);

    // Send email
    await sendReportEmail(interaction);
    logger.info(`Report email sent for ${callerId}`);

    return {
      success: true,
      message: `Interaction reported for ${callerId}.`
    };

  } catch (error) {
    logger.error('Error reporting interaction:', error);
    return {
      success: false,
      message: 'Failed to report interaction.'
    };
  }
};
