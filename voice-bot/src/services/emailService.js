import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

let transporter = null;

if (config.email.host && config.email.user) {
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

export const sendEmail = async (type, payload) => {
  if (!transporter) {
    logger.warn('Email transporter not configured. Skipping email send.');
    return;
  }

  const { callerId, callSid, timestamp } = payload;
  let subject = '';
  let htmlBody = '';

  if (type === 'success') {
    const { contactName, companyName, confirmedPhone, appointmentTime } = payload;
    subject = `🟢 SUCCESS: Technical Assessment Scheduled - ${companyName}`;
    htmlBody = `
      <h2>New Appointment Scheduled</h2>
      <ul>
        <li><strong>Company:</strong> ${companyName}</li>
        <li><strong>Contact:</strong> ${contactName}</li>
        <li><strong>Original Twilio CallerID:</strong> ${callerId}</li>
        <li><strong>Verbally Confirmed Phone:</strong> ${confirmedPhone}</li>
        <li><strong>Appointment Time:</strong> ${appointmentTime}</li>
        <li><strong>Call SID:</strong> ${callSid}</li>
        <li><strong>Timestamp:</strong> ${timestamp}</li>
      </ul>
      <p>Please follow up with this lead.</p>
    `;
  } else if (type === 'report') {
    const { reason, details } = payload;
    subject = `🟠 REPORT: Call Interaction Logged - ${callerId}`;
    htmlBody = `
      <h2>Call Interaction Report</h2>
      <ul>
        <li><strong>Twilio CallerID:</strong> ${callerId}</li>
        <li><strong>Reason:</strong> ${reason}</li>
        <li><strong>Details:</strong> ${details || 'N/A'}</li>
        <li><strong>Call SID:</strong> ${callSid}</li>
        <li><strong>Timestamp:</strong> ${timestamp}</li>
      </ul>
    `;
  } else {
    logger.error(`Unknown email type: ${type}`);
    return;
  }

  try {
    await transporter.sendMail({
      from: config.email.from || '"Sarah Assistant" <sarah@1wire.co>',
      to: config.email.to || config.email.user,
      subject: subject,
      html: htmlBody,
    });
    logger.info(`Email sent: ${subject}`);
  } catch (error) {
    logger.error('Error sending email:', error);
  }
};
