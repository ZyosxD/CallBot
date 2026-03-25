import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: config.email.port,
  secure: false, // TLS
  auth: {
    user: config.email.user,
    pass: config.email.pass
  }
});

const sendMail = async (subject, htmlBody) => {
  if (!config.email.user || !config.email.to) {
    logger.warn('Email config not set, skipping sending email.');
    return;
  }
  try {
    const info = await transporter.sendMail({
      from: `"1Wire AI Assistant" <${config.email.user}>`,
      to: config.email.to,
      subject: subject,
      html: htmlBody
    });
    logger.info(`Email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending email:', error);
  }
};

export const sendSuccessEmail = async (details) => {
  const { contactName, companyName, originalPhone, confirmedPhone, appointmentTime } = details;
  const subject = '🟢 SUCCESS: Technical Assessment Scheduled';
  const htmlBody = `
    <h2>Technical Assessment Scheduled</h2>
    <p><strong>Contact Name:</strong> ${contactName}</p>
    <p><strong>Company Name:</strong> ${companyName}</p>
    <p><strong>Caller ID (Original):</strong> ${originalPhone}</p>
    <p><strong>Confirmed Phone:</strong> ${confirmedPhone}</p>
    <p><strong>Appointment Time:</strong> ${appointmentTime}</p>
  `;
  await sendMail(subject, htmlBody);
};

export const sendReportEmail = async (details) => {
  const { originalPhone, reason, transcriptSummary } = details;
  const subject = '🟠 REPORT: Interaction Update';
  const htmlBody = `
    <h2>Interaction Report</h2>
    <p><strong>Caller ID:</strong> ${originalPhone}</p>
    <p><strong>Reason:</strong> ${reason}</p>
    <p><strong>Notes:</strong> ${transcriptSummary}</p>
  `;
  await sendMail(subject, htmlBody);
};
