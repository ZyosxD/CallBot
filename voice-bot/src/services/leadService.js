import fs from 'fs';
import path from 'path';
import logger from '../utils/logger.js';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';
import { config } from '../config/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LEADS_FILE = path.join(__dirname, '../../data/leads.json');

const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: config.email.port,
  secure: false, // true for 465, false for other ports
  auth: {
    user: config.email.user,
    pass: config.email.pass,
  },
});

const sendEmail = async (subject, htmlContent) => {
  if (!config.email.user || !config.email.pass) {
    logger.warn('Email credentials not set. Skipping email dispatch.');
    return;
  }
  try {
    await transporter.sendMail({
      from: config.email.from,
      to: config.email.user, // Sending to self/admin for notification
      subject: subject,
      html: htmlContent
    });
    logger.info(`Email sent: ${subject}`);
  } catch (error) {
    logger.error('Error sending email:', error);
  }
};

const readLeads = () => {
  try {
    if (!fs.existsSync(LEADS_FILE)) {
      return [];
    }
    const data = fs.readFileSync(LEADS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    logger.error('Error reading leads file:', error);
    return [];
  }
};

const writeLeads = (leads) => {
  try {
    fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
  } catch (error) {
    logger.error('Error writing leads file:', error);
  }
};

export const schedule_appointment = async (data) => {
  try {
    const { contactName, companyName, phone, time } = data;

    // Logic: "Trifecta + Time" must be present ideally, but we accept what AI sends
    const leads = readLeads();
    const newLead = {
      id: Date.now(),
      type: 'APPOINTMENT',
      ...data,
      createdAt: new Date().toISOString()
    };

    leads.push(newLead);
    writeLeads(leads);

    logger.info(`Lead captured: ${JSON.stringify(newLead)}`);

    // Green Email
    const subject = `✅ NEW LEAD: ${companyName} - ${contactName}`;
    const html = `
      <h2>New Appointment Scheduled</h2>
      <p><strong>Contact:</strong> ${contactName}</p>
      <p><strong>Company:</strong> ${companyName}</p>
      <p><strong>Phone:</strong> ${phone}</p>
      <p><strong>Requested Time:</strong> ${time}</p>
      <p><strong>Captured At:</strong> ${newLead.createdAt}</p>
    `;
    await sendEmail(subject, html);

    return { success: true, message: "Appointment scheduled successfully." };
  } catch (error) {
    logger.error('Error in schedule_appointment:', error);
    return { success: false, message: "Failed to schedule appointment." };
  }
};

export const report_interaction = async (data) => {
  try {
    const { result, notes, phone } = data;

    const leads = readLeads();
    const interaction = {
      id: Date.now(),
      type: 'INTERACTION_REPORT',
      ...data,
      createdAt: new Date().toISOString()
    };

    leads.push(interaction);
    writeLeads(leads);

    logger.info(`Interaction reported: ${JSON.stringify(interaction)}`);

    // Orange Email
    const subject = `🟠 REPORT: ${result}`;
    const html = `
      <h2>Call Report</h2>
      <p><strong>Result:</strong> ${result}</p>
      <p><strong>Notes:</strong> ${notes || 'N/A'}</p>
      <p><strong>Phone (if available):</strong> ${phone || 'Unknown'}</p>
      <p><strong>Time:</strong> ${interaction.createdAt}</p>
    `;
    await sendEmail(subject, html);

    return { success: true, message: "Interaction reported." };
  } catch (error) {
    logger.error('Error in report_interaction:', error);
    return { success: false, message: "Failed to report interaction." };
  }
};
