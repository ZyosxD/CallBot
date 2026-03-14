import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.smtpHost,
  port: config.email.smtpPort,
  secure: config.email.smtpPort === '465', // true for 465, false for other ports
  auth: {
    user: config.email.smtpUser,
    pass: config.email.smtpPass,
  },
});

export const sendEmailReport = async (type, payload) => {
  const { originalCallerId, confirmedPhone, contactName, companyName, appointmentTime, notes } = payload;

  let subject = '';
  let htmlContent = '';

  if (type === 'success') {
    subject = '🟢 SUCCESS: New Technical Assessment Scheduled';
    htmlContent = `
      <h2>New Appointment Scheduled!</h2>
      <p><strong>Contact Name:</strong> ${contactName}</p>
      <p><strong>Company Name:</strong> ${companyName}</p>
      <p><strong>Original Caller ID:</strong> ${originalCallerId}</p>
      <p><strong>Verbally Confirmed Phone:</strong> ${confirmedPhone}</p>
      <p><strong>Appointment Time:</strong> ${appointmentTime}</p>
      <p><strong>Notes:</strong> ${notes || 'N/A'}</p>
    `;
  } else if (type === 'report') {
    subject = '🟠 REPORT: Interaction Logged';
    htmlContent = `
      <h2>Interaction Logged</h2>
      <p><strong>Original Caller ID:</strong> ${originalCallerId}</p>
      <p><strong>Notes:</strong> ${notes || 'N/A'}</p>
    `;
  }

  const mailOptions = {
    from: '"Sarah Assistant" <no-reply@1wire.co>',
    to: config.email.notificationEmail,
    subject,
    html: htmlContent,
  };

  try {
    await transporter.sendMail(mailOptions);
    logger.info(`Email sent: ${subject}`);
  } catch (error) {
    logger.error('Error sending email report:', error);
  }
};
