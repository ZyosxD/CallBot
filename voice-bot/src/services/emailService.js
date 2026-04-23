import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

let transporter = null;

if (config.email.user && config.email.pass) {
  transporter = nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: config.email.port == 465, // true for 465, false for other ports
    auth: {
      user: config.email.user,
      pass: config.email.pass,
    },
  });
}

export const sendEmailReport = async ({ isSuccess, clientInfo, summary }) => {
  if (!transporter) {
    logger.warn('Email service is not configured. Skipping email report.');
    return;
  }

  const emoji = isSuccess ? '🟢' : '🟠';
  const subjectStr = isSuccess ? 'SUCCESS' : 'REPORT';
  const subject = `${emoji} ${subjectStr} - ${clientInfo.companyName || 'Unknown Company'}`;

  const originalPhone = clientInfo.originalPhone || 'N/A';
  const confirmedPhone = clientInfo.confirmedPhone || 'N/A';

  const html = `
    <h2>Interaction Report</h2>
    <p><strong>Company:</strong> ${clientInfo.companyName || 'N/A'}</p>
    <p><strong>Contact Name:</strong> ${clientInfo.contactName || 'N/A'}</p>
    <h3>Phone Verification</h3>
    <ul>
      <li><strong>Original Caller ID:</strong> ${originalPhone}</li>
      <li><strong>Verbally Confirmed:</strong> ${confirmedPhone}</li>
    </ul>
    <h3>Details</h3>
    <p><strong>Appointment Time:</strong> ${clientInfo.appointmentTime || 'N/A'}</p>
    <p><strong>Summary:</strong></p>
    <p>${summary}</p>
  `;

  try {
    const info = await transporter.sendMail({
      from: config.email.from,
      to: config.email.to,
      subject,
      html,
    });
    logger.info(`Email sent successfully: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending email report:', error);
  }
};
