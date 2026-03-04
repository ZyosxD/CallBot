import nodemailer from 'nodemailer';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

const transporter = nodemailer.createTransport({
  host: config.email.smtpHost,
  port: config.email.smtpPort,
  auth: {
    user: config.email.smtpUser,
    pass: config.email.smtpPass,
  },
});

export const sendEmailReport = async (type, details) => {
  try {
    const to = config.email.notificationEmail;
    if (!to) {
      logger.warn('No notification email configured.');
      return;
    }

    let subject = '';
    let html = '';

    if (type === 'SUCCESS') {
      subject = `🟢 Success: Appointment Scheduled - ${details.contactName} (${details.companyName})`;
      html = `
        <h2>New Appointment Scheduled!</h2>
        <p><strong>Contact Name:</strong> ${details.contactName}</p>
        <p><strong>Company Name:</strong> ${details.companyName}</p>
        <p><strong>Confirmed Phone:</strong> ${details.confirmedPhone}</p>
        <p><strong>Caller ID:</strong> ${details.callerId}</p>
        <p><strong>Appointment Time:</strong> ${details.appointmentTime}</p>
      `;
    } else if (type === 'REPORT') {
      subject = `🟠 Report: Interaction Logged - ${details.callerId}`;
      html = `
        <h2>Interaction Report</h2>
        <p><strong>Caller ID:</strong> ${details.callerId}</p>
        <p><strong>Outcome:</strong> ${details.outcome}</p>
        <p><strong>Notes:</strong> ${details.notes}</p>
      `;
    }

    await transporter.sendMail({
      from: config.email.smtpUser,
      to,
      subject,
      html,
    });
    logger.info(`Email report sent: ${subject}`);
  } catch (error) {
    logger.error('Error sending email report:', error);
  }
};
