import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: config.email.port,
  secure: false, // Use TLS
  auth: {
    user: config.email.user,
    pass: config.email.pass,
  },
});

export const sendReport = async (type, details) => {
  if (!config.email.notificationEmail) {
    logger.warn('No notification email configured. Skipping email report.');
    return;
  }

  let subject = '';
  let html = '';

  const { callerId, confirmedPhone, contactName, companyName, appointmentTime, notes } = details;

  const phoneComparisonHtml = `
    <h3>Phone Verification</h3>
    <p><strong>Caller ID:</strong> ${callerId || 'Unknown'}</p>
    <p><strong>Confirmed Phone:</strong> ${confirmedPhone || 'Not collected'}</p>
  `;

  if (type === 'SUCCESS') {
    subject = '🟢 Success: New Technical Assessment Scheduled';
    html = `
      <h2>New Appointment Scheduled!</h2>
      <p><strong>Contact Name:</strong> ${contactName}</p>
      <p><strong>Company Name:</strong> ${companyName}</p>
      <p><strong>Appointment Time:</strong> ${appointmentTime}</p>
      ${phoneComparisonHtml}
      <h3>Notes</h3>
      <p>${notes || 'None'}</p>
    `;
  } else if (type === 'REPORT') {
    subject = '🟠 Report: Interaction Logged';
    html = `
      <h2>Call Interaction Logged</h2>
      ${phoneComparisonHtml}
      <h3>Notes/Feedback</h3>
      <p>${notes || 'None'}</p>
    `;
  } else {
    logger.error('Invalid email report type');
    return;
  }

  try {
    await transporter.sendMail({
      from: `"Sarah (1Wire AI)" <${config.email.user}>`,
      to: config.email.notificationEmail,
      subject,
      html,
    });
    logger.info(`Email report sent successfully: ${subject}`);
  } catch (error) {
    logger.error(`Error sending email report: ${error.message}`);
  }
};
