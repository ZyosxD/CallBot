import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../data');
const CLIENTS_FILE = path.join(DATA_DIR, 'clients.json');
const LEADS_FILE = path.join(DATA_DIR, 'leads.json');
const INTERACTIONS_FILE = path.join(DATA_DIR, 'interactions.json');

async function readJson(filePath) {
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

export async function getNextPendingClient() {
  const clients = await readJson(CLIENTS_FILE);
  // Find first client with status "PENDING"
  return clients.find(client => client.status === 'PENDING');
}

export async function updateClientStatus(clientId, status, notes = '') {
  const clients = await readJson(CLIENTS_FILE);
  const clientIndex = clients.findIndex(c => c.id == clientId); // Loose equality as per memory

  if (clientIndex !== -1) {
    clients[clientIndex].status = status;
    if (notes) {
        clients[clientIndex].notes = notes;
    }
    clients[clientIndex].lastUpdated = new Date().toISOString();
    await writeJson(CLIENTS_FILE, clients);
    return true;
  }
  return false;
}

export async function saveLead(leadData) {
  const leads = await readJson(LEADS_FILE);
  const newLead = {
    id: Date.now().toString(),
    createdAt: new Date().toISOString(),
    ...leadData
  };
  leads.push(newLead);
  await writeJson(LEADS_FILE, leads);
  return newLead;
}

export async function saveInteraction(interactionData) {
  const interactions = await readJson(INTERACTIONS_FILE);
  const newInteraction = {
    id: Date.now().toString(),
    timestamp: new Date().toISOString(),
    ...interactionData
  };
  interactions.push(newInteraction);
  await writeJson(INTERACTIONS_FILE, interactions);
  return newInteraction;
}

export async function getClientById(clientId) {
    const clients = await readJson(CLIENTS_FILE);
    return clients.find(c => c.id == clientId);
}
