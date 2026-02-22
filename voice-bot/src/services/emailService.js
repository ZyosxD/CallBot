import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT, 10),
  secure: parseInt(process.env.SMTP_PORT, 10) === 465, // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export const sendReport = async (type, data = {}) => {
  if (!config.email.to) {
      logger.warn('Email notifications disabled (NOTIFICATION_EMAIL not set).');
      return;
  }

  try {
    let subject = '';
    let html = '';

    const { callerId, confirmedPhone, details, notes, name, companyName, time, result } = data;

    if (type === 'SUCCESS') {
      subject = `🟢 [SUCCESS] New Appointment: ${companyName || 'Unknown Company'}`;
      html = `
        <h2>New Technical Assessment Scheduled</h2>
        <p><strong>Status:</strong> Success 🟢</p>
        <hr>
        <h3>Contact Information</h3>
        <ul>
          <li><strong>Name:</strong> ${name || 'N/A'}</li>
          <li><strong>Company:</strong> ${companyName || 'N/A'}</li>
          <li><strong>Phone (Confirmed):</strong> ${confirmedPhone || 'N/A'}</li>
          <li><strong>Caller ID (Twilio):</strong> ${callerId || 'N/A'}</li>
          <li><strong>Appointment Time:</strong> ${time || 'N/A'}</li>
        </ul>
        <hr>
        <h3>Notes</h3>
        <p>${notes || details || 'No additional notes.'}</p>
      `;
    } else if (type === 'REPORT') {
      subject = `🟠 [REPORT] Interaction Log: ${callerId || 'Unknown'}`;
      html = `
        <h2>Call Interaction Report</h2>
        <p><strong>Status:</strong> Report 🟠</p>
        <hr>
        <h3>Details</h3>
        <ul>
          <li><strong>Caller ID:</strong> ${callerId || 'N/A'}</li>
          <li><strong>Result:</strong> ${result || 'N/A'}</li>
        </ul>
        <hr>
        <h3>Summary</h3>
        <p>${details || 'No details provided.'}</p>
      `;
    } else {
        logger.warn(`Unknown report type: ${type}`);
        return;
    }

    const info = await transporter.sendMail({
      from: `"Sarah Bot" <${process.env.SMTP_USER}>`,
      to: config.email.to, // Using config object
      subject: subject,
      html: html,
    });

    logger.info(`Email sent: ${info.messageId} (${type})`);
  } catch (error) {
    logger.error('Error sending email:', error);
  }
};
