import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

let transporter;

if (config.email && config.email.host && config.email.user) {
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

export const sendNotificationEmail = async (data) => {
  if (!transporter) {
    logger.warn('Email configuration is missing. Cannot send notification.');
    return;
  }

  const { type, callerId } = data;
  let subject = '';
  let text = '';

  if (type === 'success') {
    const { contactName, companyName, confirmedPhone, appointmentTime } = data;
    subject = '🟢 SUCCESS: New Technical Assessment Scheduled';
    text = `
Awesome! Sarah just booked a new Technical Assessment.

Details:
- Contact Name: ${contactName}
- Company Name: ${companyName}
- Appointment Time: ${appointmentTime}

Phone Verification:
- Verbally Confirmed Phone: ${confirmedPhone}
- Original Caller ID: ${callerId}
    `;
  } else if (type === 'report') {
    const { reason, notes } = data;
    subject = '🟠 REPORT: Interaction Logged';
    text = `
Sarah reported an interaction that did not result in an appointment.

Details:
- Reason: ${reason}
- Additional Notes: ${notes || 'None'}

Phone Information:
- Original Caller ID: ${callerId}
    `;
  } else {
    logger.error('Unknown email type:', type);
    return;
  }

  try {
    await transporter.sendMail({
      from: config.email.from,
      to: config.email.to,
      subject,
      text,
    });
    logger.info(`Notification email sent: ${subject}`);
  } catch (error) {
    logger.error('Error sending email notification:', error);
  }
};
