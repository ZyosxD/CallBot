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

export const getClients = async () => {
  try {
    const data = await fs.readFile(CLIENTS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    logger.error('Error reading clients file:', error);
    return [];
  }
};

export const getNextPendingClient = async () => {
  const clients = await getClients();
  return clients.find(client => client.status === 'PENDING');
};

export const updateClientStatus = async (id, status) => {
  try {
    const clients = await getClients();
    const index = clients.findIndex(c => c.id == id); // Loose equality for string/number id
    if (index !== -1) {
      clients[index].status = status;
      await fs.writeFile(CLIENTS_FILE, JSON.stringify(clients, null, 2));
      return true;
    }
    return false;
  } catch (error) {
    logger.error('Error updating client status:', error);
    return false;
  }
};

export const addLead = async (lead) => {
  try {
    let leads = [];
    try {
        const data = await fs.readFile(LEADS_FILE, 'utf-8');
        leads = JSON.parse(data);
    } catch (e) {
        // file might not exist or be empty
    }
    leads.push({ ...lead, timestamp: new Date().toISOString() });
    await fs.writeFile(LEADS_FILE, JSON.stringify(leads, null, 2));
    return true;
  } catch (error) {
    logger.error('Error adding lead:', error);
    return false;
  }
};

export const logInteraction = async (interaction) => {
  try {
    let interactions = [];
    try {
        const data = await fs.readFile(INTERACTIONS_FILE, 'utf-8');
        interactions = JSON.parse(data);
    } catch (e) {
        // file might not exist
    }
    interactions.push({ ...interaction, timestamp: new Date().toISOString() });
    await fs.writeFile(INTERACTIONS_FILE, JSON.stringify(interactions, null, 2));
    return true;
  } catch (error) {
    logger.error('Error logging interaction:', error);
    return false;
  }
};
