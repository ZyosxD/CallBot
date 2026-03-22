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
} else {
  logger.warn('Email config missing user/pass, emailService will just log.');
}

export const sendNotificationEmail = async ({ type, callerId, confirmedPhone, data }) => {
  const isSuccess = type === 'SUCCESS';
  const emoji = isSuccess ? '🟢' : '🟠';
  const statusStr = isSuccess ? 'SUCCESS' : 'REPORT';
  const subject = `${emoji} ${statusStr} - 1Wire Assistant Call`;

  let html = `<h2>Call ${statusStr}</h2>`;
  html += `<ul>
    <li><strong>Twilio CallerID:</strong> ${callerId || 'Unknown'}</li>
    <li><strong>Verbally Confirmed Phone:</strong> ${confirmedPhone || 'None'}</li>
  </ul>`;

  if (isSuccess && data) {
    html += `<h3>Appointment Details:</h3>
    <ul>
      <li><strong>Contact Name:</strong> ${data.contactName || ''}</li>
      <li><strong>Company Name:</strong> ${data.companyName || ''}</li>
      <li><strong>Time:</strong> ${data.appointmentTime || ''}</li>
    </ul>`;
  } else if (!isSuccess && data) {
    html += `<h3>Report Details:</h3>
    <p>${data.reason || data.summary || ''}</p>`;
  }

  logger.info(`Email sending: [${subject}] from CallerID: ${callerId}`);

  if (transporter && config.email.to) {
    try {
      await transporter.sendMail({
        from: `"Sarah 1Wire" <${config.email.user}>`,
        to: config.email.to,
        subject: subject,
        html: html,
      });
      logger.info('Email sent successfully.');
    } catch (error) {
      logger.error('Error sending email:', error);
    }
  } else {
    logger.info('Email mock send (no config):', html);
  }
};