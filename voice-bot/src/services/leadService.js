import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../../');

const CLIENTS_FILE = path.join(DATA_DIR, 'clients.json');
const LEADS_FILE = path.join(DATA_DIR, 'leads.json');
const INTERACTIONS_FILE = path.join(DATA_DIR, 'interactions.json');

// Ensure files exist
async function ensureFile(filePath, defaultContent = []) {
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, JSON.stringify(defaultContent, null, 2));
  }
}

export const initDataFiles = async () => {
    await ensureFile(CLIENTS_FILE);
    await ensureFile(LEADS_FILE);
    await ensureFile(INTERACTIONS_FILE);
};

// --- Clients (The Drip Source) ---

export const getNextPendingClient = async () => {
  try {
    const data = await fs.readFile(CLIENTS_FILE, 'utf-8');
    const clients = JSON.parse(data);
    const pending = clients.find(c => c.status === 'PENDING');
    return pending;
  } catch (error) {
    logger.error('Error reading clients.json:', error);
    return null;
  }
};

export const updateClientStatus = async (clientId, newStatus) => {
  try {
    const data = await fs.readFile(CLIENTS_FILE, 'utf-8');
    let clients = JSON.parse(data);

    // Loose equality to handle string/number mismatch
    const index = clients.findIndex(c => c.id == clientId);

    if (index !== -1) {
      clients[index].status = newStatus;
      clients[index].lastUpdated = new Date().toISOString();
      await fs.writeFile(CLIENTS_FILE, JSON.stringify(clients, null, 2));
      return true;
    }
    return false;
  } catch (error) {
    logger.error('Error updating client status:', error);
    return false;
  }
};

// --- Leads (The Successes) ---

export const saveLead = async (leadData) => {
  try {
    const data = await fs.readFile(LEADS_FILE, 'utf-8');
    const leads = JSON.parse(data);

    const newLead = {
      id: Date.now(),
      ...leadData,
      createdAt: new Date().toISOString()
    };

    leads.push(newLead);
    await fs.writeFile(LEADS_FILE, JSON.stringify(leads, null, 2));
    logger.info(`Lead saved: ${newLead.id}`);
    return newLead;
  } catch (error) {
    logger.error('Error saving lead:', error);
    throw error;
  }
};

// --- Interactions (The Logs) ---

export const logInteraction = async (interactionData) => {
  try {
    const data = await fs.readFile(INTERACTIONS_FILE, 'utf-8');
    const interactions = JSON.parse(data);

    const newInteraction = {
      id: Date.now(),
      ...interactionData,
      timestamp: new Date().toISOString()
    };

    interactions.push(newInteraction);
    await fs.writeFile(INTERACTIONS_FILE, JSON.stringify(interactions, null, 2));
    logger.info(`Interaction logged: ${newInteraction.id}`);
    return newInteraction;
  } catch (error) {
    logger.error('Error logging interaction:', error);
  }
};
