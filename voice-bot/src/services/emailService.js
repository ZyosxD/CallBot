import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.smtp.host,
  port: config.email.smtp.port,
  secure: false, // TLS
  auth: {
    user: config.email.smtp.user,
    pass: config.email.smtp.pass,
  },
});

export const sendReportEmail = async (subject, htmlContent) => {
  try {
    const info = await transporter.sendMail({
      from: `"1Wire Sarah Bot" <${config.email.smtp.user}>`,
      to: config.email.notificationEmail,
      subject,
      html: htmlContent,
    });
    logger.info(`Email sent successfully: ${info.messageId}`);
    return true;
  } catch (error) {
    logger.error('Failed to send email report:', error);
    return false;
  }
};

export const sendSuccessReport = async (leadData) => {
  const subject = '🟢 SUCCESS: New Technical Assessment Scheduled';
  const html = `
    <h2>Lead Details</h2>
    <ul>
      <li><strong>Contact Name:</strong> ${leadData.contactName}</li>
      <li><strong>Company Name:</strong> ${leadData.companyName}</li>
      <li><strong>Twilio Caller ID:</strong> ${leadData.callerId}</li>
      <li><strong>Verbally Confirmed Phone:</strong> ${leadData.confirmedPhone}</li>
      <li><strong>Appointment Time:</strong> ${leadData.appointmentTime}</li>
      <li><strong>Notes/Needs:</strong> ${leadData.notes || 'None provided'}</li>
    </ul>
  `;
  return sendReportEmail(subject, html);
};

export const sendInteractionReport = async (interactionData) => {
  const subject = '🟠 REPORT: Interaction Logged';
  const html = `
    <h2>Interaction Details</h2>
    <ul>
      <li><strong>Twilio Caller ID:</strong> ${interactionData.callerId}</li>
      <li><strong>Status:</strong> ${interactionData.status}</li>
      <li><strong>Summary:</strong> ${interactionData.summary}</li>
      <li><strong>Duration (approx):</strong> ${interactionData.duration || 'N/A'}</li>
    </ul>
  `;
  return sendReportEmail(subject, html);
};
