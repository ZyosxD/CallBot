import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../data');
const CLIENTS_FILE = path.join(DATA_DIR, 'clients.json');
const LEADS_FILE = path.join(DATA_DIR, 'leads.json');
const INTERACTIONS_FILE = path.join(DATA_DIR, 'interactions.json');

export const getNextPendingClient = async () => {
  try {
    const data = await fs.readFile(CLIENTS_FILE, 'utf-8');
    const clients = JSON.parse(data);
    const client = clients.find(c => c.status === 'PENDING');
    return client;
  } catch (error) {
    logger.error('Error reading clients file:', error);
    return null;
  }
};

export const getClientById = async (clientId) => {
  try {
    const data = await fs.readFile(CLIENTS_FILE, 'utf-8');
    const clients = JSON.parse(data);
    return clients.find(c => c.id == clientId) || null;
  } catch (error) {
    logger.error('Error reading clients file:', error);
    return null;
  }
};

export const updateClientStatus = async (clientId, status) => {
  try {
    const data = await fs.readFile(CLIENTS_FILE, 'utf-8');
    let clients = JSON.parse(data);
    const index = clients.findIndex(c => c.id == clientId); // Loose equality for string/number id match
    if (index !== -1) {
      clients[index].status = status;
      await fs.writeFile(CLIENTS_FILE, JSON.stringify(clients, null, 2));
      logger.info(`Updated client ${clientId} status to ${status}`);
      return true;
    }
    return false;
  } catch (error) {
    logger.error('Error updating client status:', error);
    return false;
  }
};

export const saveLead = async (leadData) => {
  try {
    const data = await fs.readFile(LEADS_FILE, 'utf-8');
    const leads = JSON.parse(data);
    leads.push({ ...leadData, timestamp: new Date().toISOString() });
    await fs.writeFile(LEADS_FILE, JSON.stringify(leads, null, 2));
    logger.info('Lead saved successfully');
    return true;
  } catch (error) {
    logger.error('Error saving lead:', error);
    return false;
  }
};

export const logInteraction = async (interactionData) => {
  try {
    const data = await fs.readFile(INTERACTIONS_FILE, 'utf-8');
    const interactions = JSON.parse(data);
    interactions.push({ ...interactionData, timestamp: new Date().toISOString() });
    await fs.writeFile(INTERACTIONS_FILE, JSON.stringify(interactions, null, 2));
    logger.info('Interaction logged successfully');
    return true;
  } catch (error) {
    logger.error('Error logging interaction:', error);
    return false;
  }
};
