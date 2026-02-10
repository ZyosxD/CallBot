import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../data');
const CLIENTS_FILE = path.join(DATA_DIR, 'clients.json');
const LEADS_FILE = path.join(DATA_DIR, 'leads.json');
const INTERACTIONS_FILE = path.join(DATA_DIR, 'interactions.json');

const transporter = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  auth: {
    user: config.smtp.user,
    pass: config.smtp.pass
  }
});

async function sendEmail(subject, color, content) {
  try {
    const html = `
      <div style="font-family: Arial, sans-serif; padding: 20px; border-left: 5px solid ${color};">
        <h2 style="color: ${color};">${subject}</h2>
        ${content}
      </div>
    `;

    await transporter.sendMail({
      from: config.smtp.user,
      to: config.smtp.notificationEmail,
      subject: `[${subject}]`,
      html
    });
    logger.info(`Email sent: ${subject}`);
  } catch (error) {
    logger.error('Error sending email:', error);
  }
}

export async function getNextPendingClient() {
  try {
    const data = await fs.readFile(CLIENTS_FILE, 'utf-8');
    const clients = JSON.parse(data);
    const client = clients.find(c => c.status === 'PENDING');
    return client;
  } catch (error) {
    logger.error('Error reading clients:', error);
    return null;
  }
}

export async function markClientCalled(clientId) {
  try {
    const data = await fs.readFile(CLIENTS_FILE, 'utf-8');
    let clients = JSON.parse(data);

    // Loose equality check for clientId as per memory
    const index = clients.findIndex(c => c.id == clientId);
    if (index !== -1) {
      clients[index].status = 'CALLED';
      clients[index].lastCalledAt = new Date().toISOString();
      await fs.writeFile(CLIENTS_FILE, JSON.stringify(clients, null, 2));
      logger.info(`Marked client ${clientId} as CALLED`);
    }
  } catch (error) {
    logger.error('Error updating client status:', error);
  }
}

export async function saveLead(leadData) {
  try {
    const data = await fs.readFile(LEADS_FILE, 'utf-8');
    const leads = JSON.parse(data);
    leads.push({ ...leadData, timestamp: new Date().toISOString() });
    await fs.writeFile(LEADS_FILE, JSON.stringify(leads, null, 2));

    const emailContent = `
      <p><strong>Contact Name:</strong> ${leadData.contactName}</p>
      <p><strong>Company Name:</strong> ${leadData.companyName}</p>
      <p><strong>Confirmed Phone:</strong> ${leadData.confirmedPhone}</p>
      <p><strong>Twilio Caller ID:</strong> ${leadData.twilioCallerId}</p>
      <p><strong>Meeting Time:</strong> ${leadData.meetingTime}</p>
      <p><strong>Notes:</strong> ${leadData.notes || 'None'}</p>
    `;

    await sendEmail('NEW APPOINTMENT (SUCCESS)', 'green', emailContent);
    return true;
  } catch (error) {
    logger.error('Error saving lead:', error);
    return false;
  }
}

export async function saveInteraction(interactionData) {
  try {
    const data = await fs.readFile(INTERACTIONS_FILE, 'utf-8');
    const interactions = JSON.parse(data);
    interactions.push({ ...interactionData, timestamp: new Date().toISOString() });
    await fs.writeFile(INTERACTIONS_FILE, JSON.stringify(interactions, null, 2));

    const emailContent = `
      <p><strong>Result:</strong> ${interactionData.result}</p>
      <p><strong>Twilio Caller ID:</strong> ${interactionData.twilioCallerId}</p>
      <p><strong>Notes:</strong> ${interactionData.notes || 'None'}</p>
    `;

    await sendEmail('INTERACTION REPORT', 'orange', emailContent);
    return true;
  } catch (error) {
    logger.error('Error saving interaction:', error);
    return false;
  }
}
