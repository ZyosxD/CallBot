import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

let transporter = null;

if (config.email.smtpHost && config.email.smtpUser) {
  transporter = nodemailer.createTransport({
    host: config.email.smtpHost,
    port: config.email.smtpPort,
    secure: false, // true for 465, false for other ports
    auth: {
      user: config.email.smtpUser,
      pass: config.email.smtpPass,
    },
  });
} else {
  logger.warn('SMTP configuration is missing. Emails will not be sent.');
}

export const sendEmail = async (subject, htmlContent) => {
  if (!transporter) {
    logger.warn('Email transporter not initialized. Skipping email send.');
    return;
  }

  if (!config.email.notificationEmail) {
    logger.warn('Notification email address is missing. Skipping email send.');
    return;
  }

  try {
    const info = await transporter.sendMail({
      from: `"1Wire Assistant" <${config.email.smtpUser}>`,
      to: config.email.notificationEmail,
      subject: subject,
      html: htmlContent,
    });
    logger.info(`Email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending email:', error);
  }
};

export const sendSuccessEmail = async (details, callerId) => {
  const subject = `🟢 Success: Appointment Scheduled - ${details.companyName}`;
  const html = `
    <h2>New Appointment Scheduled!</h2>
    <p><strong>Contact Name:</strong> ${details.contactName}</p>
    <p><strong>Company Name:</strong> ${details.companyName}</p>
    <p><strong>Appointment Time:</strong> ${details.appointmentTime}</p>
    <br/>
    <h3>Phone Comparison:</h3>
    <p><strong>Twilio Caller ID:</strong> ${callerId || 'Unknown'}</p>
    <p><strong>Confirmed Phone:</strong> ${details.confirmedPhone}</p>
    ${callerId !== details.confirmedPhone ? '<p style="color:red;"><strong>Warning: Phone numbers do not match!</strong></p>' : '<p style="color:green;"><strong>Phone numbers match.</strong></p>'}
  `;
  await sendEmail(subject, html);
};

export const sendReportEmail = async (reportDetails, callerId) => {
  const subject = `🟠 Report: Call Outcome - ${callerId || 'Unknown'}`;
  const html = `
    <h2>Call Report</h2>
    <p><strong>Status:</strong> ${reportDetails.outcome}</p>
    <p><strong>Notes:</strong> ${reportDetails.notes}</p>
    <br/>
    <h3>Phone Comparison:</h3>
    <p><strong>Twilio Caller ID:</strong> ${callerId || 'Unknown'}</p>
    <p><strong>Confirmed Phone (if collected):</strong> ${reportDetails.confirmedPhone || 'N/A'}</p>
  `;
  await sendEmail(subject, html);
};
