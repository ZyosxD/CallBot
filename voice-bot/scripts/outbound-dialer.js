import fs from 'fs';
import path from 'path';
import twilio from 'twilio';
import { config } from '../src/config/config.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLIENTS_FILE = path.join(__dirname, '../data/clients.json');

const dialNextClient = async () => {
  console.log('Starting Smart Drip Dialer...');

  if (!config.twilio.accountSid || !config.twilio.authToken || !config.twilio.phoneNumber) {
    console.error('Twilio credentials missing.');
    process.exit(1);
  }

  const client = twilio(config.twilio.accountSid, config.twilio.authToken);

  // 1. Read Database
  if (!fs.existsSync(CLIENTS_FILE)) {
    console.error('clients.json not found.');
    process.exit(1);
  }

  let clients = [];
  try {
    clients = JSON.parse(fs.readFileSync(CLIENTS_FILE, 'utf8'));
  } catch (error) {
    console.error('Error reading clients.json', error);
    process.exit(1);
  }

  // 2. Find Candidate
  const candidateIndex = clients.findIndex(c => c.status === 'PENDING');
  if (candidateIndex === -1) {
    console.log('No PENDING clients found. Drip paused.');
    process.exit(0);
  }

  const candidate = clients[candidateIndex];
  console.log(`Found candidate: ${candidate.name} (${candidate.phone})`);

  // 3. Mark as CALLED (Optimistic Locking)
  clients[candidateIndex].status = 'CALLED';
  clients[candidateIndex].lastCalled = new Date().toISOString();
  fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));

  // 4. Execute Call
  const publicUrl = config.server.publicUrl;
  if (!publicUrl) {
    console.error('PUBLIC_URL not set in env. Cannot configure TwiML.');
    // Revert status? Maybe. But strict spec says "mark immediately".
    process.exit(1);
  }

  try {
    const call = await client.calls.create({
      url: `${publicUrl}/voice/outbound`,
      to: candidate.phone,
      from: config.twilio.phoneNumber,
    });
    console.log(`Call initiated. SID: ${call.sid}`);
  } catch (error) {
    console.error('Error initiating call:', error);
    // Optional: Revert status to 'FAILED' or 'PENDING'
    clients[candidateIndex].status = 'FAILED';
    fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));
  }
};

dialNextClient();
