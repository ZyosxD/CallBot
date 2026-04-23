import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

let transporter;

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
}

export const sendSuccessEmail = async (leadData) => {
  if (!transporter) {
    logger.warn('Email transporter not configured. Skipping success email.');
    return;
  }

  const mailOptions = {
    from: config.email.from,
    to: config.email.to,
    subject: '🟢 SUCCESS: Technical Assessment Scheduled',
    text: `
We have successfully scheduled a Technical Assessment!

Contact Name: ${leadData.contactName || 'N/A'}
Company Name: ${leadData.companyName || 'N/A'}
Appointment Time: ${leadData.appointmentTime || 'N/A'}

--- Phone Verification ---
Original Caller ID (Twilio): ${leadData.callerId || 'Unknown'}
Verbally Confirmed Phone: ${leadData.confirmedPhone || 'Unknown'}

--- Additional Details ---
${leadData.notes || 'None'}
    `.trim()
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    logger.info(`Success email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (interactionData) => {
  if (!transporter) {
    logger.warn('Email transporter not configured. Skipping report email.');
    return;
  }

  const mailOptions = {
    from: config.email.from,
    to: config.email.to,
    subject: '🟠 REPORT: Interaction Ended',
    text: `
An interaction ended without an appointment.

Reason/Status: ${interactionData.status || 'Not interested/Voicemail/Call back later'}

--- Phone Verification ---
Original Caller ID (Twilio): ${interactionData.callerId || 'Unknown'}
Verbally Confirmed Phone: ${interactionData.confirmedPhone || 'N/A'}

--- Details ---
${interactionData.notes || 'None'}
    `.trim()
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    logger.info(`Report email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
