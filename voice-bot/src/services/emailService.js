import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: config.email.port,
  secure: false, // true for 465, false for other ports
  auth: {
    user: config.email.user,
    pass: config.email.pass,
  },
});

export const sendEmail = async ({ subject, text, html }) => {
  try {
    const info = await transporter.sendMail({
      from: config.email.from,
      to: config.email.to,
      subject,
      text,
      html,
    });
    logger.info(`Email sent: ${info.messageId}`);
    return info;
  } catch (error) {
    logger.error('Error sending email:', error);
    throw error;
  }
};

export const sendSuccessEmail = async (appointmentData) => {
  const { contactName, companyName, verifiedPhone, callerId, appointmentTime, needs } = appointmentData;
  const subject = `🟢 SUCCESS: Technical Assessment Scheduled - ${companyName}`;
  const html = `
    <h2>New Technical Assessment Scheduled!</h2>
    <p><strong>Contact Name:</strong> ${contactName}</p>
    <p><strong>Company Name:</strong> ${companyName}</p>
    <p><strong>Verified Phone:</strong> ${verifiedPhone}</p>
    <p><strong>Original Caller ID:</strong> ${callerId}</p>
    <p><strong>Appointment Time:</strong> ${appointmentTime}</p>
    <p><strong>Identified Needs:</strong> ${needs || 'N/A'}</p>
  `;
  return sendEmail({ subject, html });
};

export const sendReportEmail = async (interactionData) => {
  const { reason, notes, verifiedPhone, callerId } = interactionData;
  const subject = `🟠 REPORT: Interaction Logged - ${reason}`;
  const html = `
    <h2>Interaction Report</h2>
    <p><strong>Reason:</strong> ${reason}</p>
    <p><strong>Notes:</strong> ${notes}</p>
    <p><strong>Verified Phone:</strong> ${verifiedPhone || 'N/A'}</p>
    <p><strong>Original Caller ID:</strong> ${callerId}</p>
  `;
  return sendEmail({ subject, html });
};
