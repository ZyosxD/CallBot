import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.smtpHost,
  port: config.email.smtpPort,
  secure: config.email.smtpPort === 465, // true for 465, false for other ports
  auth: {
    user: config.email.smtpUser,
    pass: config.email.smtpPass,
  },
});

export async function sendEmailReport({ type, lead, interaction }) {
  if (!config.email.notifyTo) {
    logger.warn('Email notification requested but NOTIFY_TO is not configured.');
    return;
  }

  let subject = '';
  let text = '';

  if (type === 'SUCCESS' && lead) {
    subject = `🟢 SUCCESS: New Appointment Scheduled - ${lead.companyName || 'Unknown Company'}`;
    text = `
Great news! A new technical assessment has been scheduled.

Contact Name: ${lead.contactName}
Company Name: ${lead.companyName}
Appointment Time: ${lead.appointmentTime}

--- Phone Verification ---
Original Caller ID: ${lead.originalCallerId}
Verbally Confirmed Phone: ${lead.confirmedPhone}
-------------------------

Timestamp: ${lead.timestamp}
    `.trim();
  } else if (type === 'REPORT' && interaction) {
    subject = `🟠 REPORT: Interaction Logged - ${interaction.reason}`;
    text = `
An interaction has been logged without scheduling an appointment.

Reason: ${interaction.reason}
Details: ${interaction.details || 'N/A'}
Original Caller ID: ${interaction.originalCallerId}
Timestamp: ${interaction.timestamp}
    `.trim();
  }

  try {
    const info = await transporter.sendMail({
      from: `"1Wire Assistant" <${config.email.smtpUser}>`,
      to: config.email.notifyTo,
      subject: subject,
      text: text,
    });
    logger.info(`Email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending email report:', error);
  }
}
