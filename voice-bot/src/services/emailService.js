import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

let transporter;

try {
  transporter = nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: config.email.secure,
    auth: {
      user: config.email.auth.user,
      pass: config.email.auth.pass
    }
  });
} catch (error) {
  logger.error('Failed to initialize nodemailer transporter:', error);
}

/**
 * Sends a notification email comparing CallerID and verbally confirmed phone.
 * @param {string} type - 'success' or 'report'
 * @param {object} data - Data to send in the email
 */
export const sendNotification = async (type, data) => {
  if (!transporter) {
    logger.warn('Email transporter not configured, skipping notification email.');
    return;
  }

  const isSuccess = type === 'success';
  const icon = isSuccess ? '🟢 SUCCESS' : '🟠 REPORT';

  const subject = `${icon} - 1Wire Assistant - ${isSuccess ? 'New Assessment Scheduled' : 'Call Report'}`;

  const callerIdPhone = data.callerId || 'Unknown';
  const verbalPhone = data.confirmedPhone || 'None Provided';

  let html = `
    <h2>${subject}</h2>
    <p><strong>Caller ID Number:</strong> ${callerIdPhone}</p>
    <p><strong>Verbally Confirmed Number:</strong> ${verbalPhone}</p>
    <hr>
  `;

  if (isSuccess) {
    html += `
      <p><strong>Contact Name:</strong> ${data.contactName}</p>
      <p><strong>Company Name:</strong> ${data.companyName}</p>
      <p><strong>Scheduled Time:</strong> ${data.appointmentTime}</p>
      <p><strong>Details/Needs Detected:</strong> ${data.details || 'N/A'}</p>
    `;
  } else {
    html += `
      <p><strong>Interaction Status:</strong> ${data.status}</p>
      <p><strong>Reason:</strong> ${data.reason || 'Client not interested, requested callback, or voicemail reached.'}</p>
    `;
  }

  const mailOptions = {
    from: config.email.from || '"1Wire Sarah" <noreply@1wire.co>',
    to: config.email.to,
    subject,
    html
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    logger.info(`Email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending notification email:', error);
  }
};
