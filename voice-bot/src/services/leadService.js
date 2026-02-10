import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../');

const CLIENTS_FILE = path.join(rootDir, 'clients.json');
const LEADS_FILE = path.join(rootDir, 'leads.json');
const INTERACTIONS_FILE = path.join(rootDir, 'interactions.json');

// Helper to read JSON
const readJson = (filePath) => {
  try {
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error);
    return [];
  }
};

// Helper to write JSON
const writeJson = (filePath, data) => {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error(`Error writing ${filePath}:`, error);
  }
};

export const getPendingClient = () => {
  const clients = readJson(CLIENTS_FILE);
  return clients.find(client => client.status === 'PENDING');
};

export const updateClientStatus = (clientId, status) => {
  const clients = readJson(CLIENTS_FILE);
  const index = clients.findIndex(c => c.id == clientId); // Loose equality for string/number id
  if (index !== -1) {
    clients[index].status = status;
    writeJson(CLIENTS_FILE, clients);
    return true;
  }
  return false;
};

export const addLead = (leadData) => {
  const leads = readJson(LEADS_FILE);
  leads.push({ ...leadData, timestamp: new Date().toISOString() });
  writeJson(LEADS_FILE, leads);
};

export const addInteraction = (interactionData) => {
  const interactions = readJson(INTERACTIONS_FILE);
  interactions.push({ ...interactionData, timestamp: new Date().toISOString() });
  writeJson(INTERACTIONS_FILE, interactions);
};
