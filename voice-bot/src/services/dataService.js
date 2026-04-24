import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../data');

const getJsonFile = async (filename) => {
    try {
        const data = await fs.readFile(path.join(DATA_DIR, filename), 'utf8');
        return JSON.parse(data);
    } catch (err) {
        if (err.code === 'ENOENT') return [];
        throw err;
    }
};

const writeJsonFile = async (filename, data) => {
    await fs.writeFile(path.join(DATA_DIR, filename), JSON.stringify(data, null, 2), 'utf8');
};

export const getClients = async () => {
    return getJsonFile('clients.json');
};

export const updateClientStatus = async (phone, status) => {
    const clients = await getClients();
    const updated = clients.map(c => c.phone === phone ? { ...c, status } : c);
    await writeJsonFile('clients.json', updated);
};

export const appendLead = async (lead) => {
    const leads = await getJsonFile('leads.json');
    leads.push({ ...lead, timestamp: new Date().toISOString() });
    await writeJsonFile('leads.json', leads);
};

export const appendInteraction = async (interaction) => {
    const interactions = await getJsonFile('interactions.json');
    interactions.push({ ...interaction, timestamp: new Date().toISOString() });
    await writeJsonFile('interactions.json', interactions);
};
