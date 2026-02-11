import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';
import dayjs from 'dayjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../data');

const CLIENTS_FILE = path.join(DATA_DIR, 'clients.json');
const LEADS_FILE = path.join(DATA_DIR, 'leads.json');
const INTERACTIONS_FILE = path.join(DATA_DIR, 'interactions.json');

// Email Transporter
const transporter = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: false, // true for 465, false for other ports
  auth: {
    user: config.smtp.user,
    pass: config.smtp.pass,
  },
});

async function sendEmail(subject, htmlContent) {
  try {
    const info = await transporter.sendMail({
      from: `"Sarah - 1Wire Assistant" <${config.smtp.user}>`,
      to: config.smtp.notificationEmail,
      subject: subject,
      html: htmlContent,
    });
    logger.info(`Email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending email:', error);
  }
}

async function readJsonFile(filePath) {
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    logger.error(`Error reading file ${filePath}:`, error);
    return [];
  }
}

async function writeJsonFile(filePath, data) {
  try {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
  } catch (error) {
    logger.error(`Error writing file ${filePath}:`, error);
  }
}

export async function getNextPendingClient() {
  const clients = await readJsonFile(CLIENTS_FILE);
  return clients.find(c => c.status === 'PENDING');
}

export async function updateClientStatus(clientId, status) {
  const clients = await readJsonFile(CLIENTS_FILE);
  const clientIndex = clients.findIndex(c => c.id == clientId); // Loose equality for string/number mismatch
  if (clientIndex !== -1) {
    clients[clientIndex].status = status;
    await writeJsonFile(CLIENTS_FILE, clients);
    logger.info(`Updated client ${clientId} status to ${status}`);
  } else {
    logger.warn(`Client ${clientId} not found for status update`);
  }
}

export async function scheduleAppointment(data) {
  logger.info('Scheduling appointment:', data);
  const leads = await readJsonFile(LEADS_FILE);
  const newLead = {
    ...data,
    timestamp: new Date().toISOString(),
  };
  leads.push(newLead);
  await writeJsonFile(LEADS_FILE, leads);

  // Send Green Email
  const subject = `🟢 NEW APPOINTMENT: ${data.company || 'Unknown Company'}`;
  const html = `
    <h1>New Technical Assessment Scheduled</h1>
    <p><strong>Contact Name:</strong> ${data.name}</p>
    <p><strong>Company:</strong> ${data.company}</p>
    <p><strong>Phone (Verbal):</strong> ${data.phone}</p>
    <p><strong>Caller ID:</strong> ${data.callerId || 'N/A'}</p>
    <p><strong>Date/Time:</strong> ${data.dateTime}</p>
    <p><strong>Notes:</strong> ${data.notes || 'N/A'}</p>
  `;
  await sendEmail(subject, html);
  return { success: true, message: "Appointment scheduled successfully" };
}

export async function reportInteraction(data) {
  logger.info('Reporting interaction:', data);
  const interactions = await readJsonFile(INTERACTIONS_FILE);
  const newInteraction = {
    ...data,
    timestamp: new Date().toISOString(),
  };
  interactions.push(newInteraction);
  await writeJsonFile(INTERACTIONS_FILE, interactions);

  // Send Orange Email
  const subject = `🟠 INTERACTION REPORT: ${data.outcome || 'General'}`;
  const html = `
    <h1>Interaction Report</h1>
    <p><strong>Outcome:</strong> ${data.outcome}</p>
    <p><strong>Caller ID:</strong> ${data.callerId || 'N/A'}</p>
    <p><strong>Notes:</strong> ${data.notes || 'N/A'}</p>
  `;
  await sendEmail(subject, html);
  return { success: true, message: "Interaction reported successfully" };
}
