import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

let transporter = null;

if (config.email.user && config.email.pass) {
  transporter = nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: config.email.port == 465,
    auth: {
      user: config.email.user,
      pass: config.email.pass,
    },
  });
}

export const sendSuccessEmail = async (leadData) => {
  if (!transporter) {
    logger.warn('Email transporter not configured. Skipping success email.');
    return;
  }

  const { contactName, companyName, confirmedPhone, callerId, appointmentTime, needs } = leadData;
  const phoneMatch = confirmedPhone === callerId ? 'MATCH' : 'MISMATCH';

  const html = `
    <h2>🟢 SUCCESS: New Appointment Scheduled</h2>
    <p><strong>Contact Name:</strong> ${contactName}</p>
    <p><strong>Company Name:</strong> ${companyName}</p>
    <p><strong>Appointment Time:</strong> ${appointmentTime}</p>
    <p><strong>Needs Detected:</strong> ${needs || 'Not specified'}</p>
    <hr/>
    <h3>Phone Verification</h3>
    <p><strong>Twilio CallerID:</strong> ${callerId}</p>
    <p><strong>Confirmed Phone:</strong> ${confirmedPhone}</p>
    <p><strong>Status:</strong> ${phoneMatch}</p>
  `;

  try {
    await transporter.sendMail({
      from: config.email.from,
      to: config.email.to,
      subject: `🟢 SUCCESS: Appointment - ${companyName}`,
      html
    });
    logger.info(`Success email sent for ${companyName}`);
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (interactionData) => {
  if (!transporter) {
    logger.warn('Email transporter not configured. Skipping report email.');
    return;
  }

  const { callerId, status, notes } = interactionData;

  const html = `
    <h2>🟠 REPORT: Call Interaction</h2>
    <p><strong>CallerID:</strong> ${callerId}</p>
    <p><strong>Status:</strong> ${status}</p>
    <p><strong>Notes:</strong> ${notes || 'No notes provided'}</p>
  `;

  try {
    await transporter.sendMail({
      from: config.email.from,
      to: config.email.to,
      subject: `🟠 REPORT: Interaction - ${callerId}`,
      html
    });
    logger.info(`Report email sent for ${callerId}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
