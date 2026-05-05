import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: config.email.port,
  secure: config.email.port === 465,
  auth: {
    user: config.email.user,
    pass: config.email.pass
  }
});

export async function sendEmail({ subject, html }) {
  try {
    const info = await transporter.sendMail({
      from: config.email.from,
      to: config.email.to,
      subject,
      html
    });
    logger.info(`Email sent: ${info.messageId}`);
    return true;
  } catch (error) {
    logger.error('Error sending email:', error);
    return false;
  }
}

export async function sendSuccessEmail(leadData) {
  const subject = `🟢 SUCCESS: New Technical Assessment Scheduled - ${leadData.companyName}`;
  const html = `
    <h2>New Appointment Scheduled!</h2>
    <p><strong>Company:</strong> ${leadData.companyName}</p>
    <p><strong>Contact Name:</strong> ${leadData.contactName}</p>
    <p><strong>Twilio Caller ID:</strong> ${leadData.callerId}</p>
    <p><strong>Verbally Confirmed Phone:</strong> ${leadData.confirmedPhone}</p>
    <p><strong>Appointment Time:</strong> ${leadData.appointmentTime}</p>
    <p><strong>Needs Detected:</strong> ${leadData.needsDetected || 'N/A'}</p>
    <p><strong>Notes:</strong> ${leadData.notes || 'N/A'}</p>
  `;
  return sendEmail({ subject, html });
}

export async function sendReportEmail(interactionData) {
  const subject = `🟠 REPORT: Lead Interaction - ${interactionData.companyName || 'Unknown Company'}`;
  const html = `
    <h2>Interaction Report</h2>
    <p><strong>Status:</strong> ${interactionData.status}</p>
    <p><strong>Company:</strong> ${interactionData.companyName || 'N/A'}</p>
    <p><strong>Contact Name:</strong> ${interactionData.contactName || 'N/A'}</p>
    <p><strong>Twilio Caller ID:</strong> ${interactionData.callerId}</p>
    <p><strong>Verbally Confirmed Phone:</strong> ${interactionData.confirmedPhone || 'N/A'}</p>
    <p><strong>Reason:</strong> ${interactionData.reason}</p>
    <p><strong>Notes:</strong> ${interactionData.notes || 'N/A'}</p>
  `;
  return sendEmail({ subject, html });
}
