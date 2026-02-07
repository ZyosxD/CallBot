import fs from 'fs';
import path from 'path';
import logger from '../utils/logger.js';

const LEADS_FILE = path.resolve('leads.json');
const LOGS_FILE = path.resolve('interactions.json');

export const saveLead = async (data) => {
  try {
    let leads = [];
    if (fs.existsSync(LEADS_FILE)) {
      const fileData = fs.readFileSync(LEADS_FILE, 'utf8');
      leads = JSON.parse(fileData);
    } else {
        fs.writeFileSync(LEADS_FILE, '[]');
    }

    const lead = {
      id: Date.now(),
      ...data,
      timestamp: new Date().toISOString()
    };

    leads.push(lead);
    fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
    logger.info(`Lead saved: ${data.name} - ${data.company}`);
    return true;
  } catch (error) {
    logger.error('Error saving lead:', error);
    return false;
  }
};

export const logInteraction = async (data) => {
  try {
    let logs = [];
    if (fs.existsSync(LOGS_FILE)) {
        const fileData = fs.readFileSync(LOGS_FILE, 'utf8');
        logs = JSON.parse(fileData);
    } else {
        fs.writeFileSync(LOGS_FILE, '[]');
    }

    const logEntry = {
        id: Date.now(),
        ...data,
        timestamp: new Date().toISOString()
    };

    logs.push(logEntry);
    fs.writeFileSync(LOGS_FILE, JSON.stringify(logs, null, 2));
    logger.info(`Interaction logged for ${data.phone}: ${data.status}`);
    return true;
  } catch (error) {
      logger.error('Error logging interaction:', error);
      return false;
  }
};
