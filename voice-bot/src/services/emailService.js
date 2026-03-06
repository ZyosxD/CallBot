import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.smtpHost,
  port: config.email.smtpPort,
  secure: config.email.smtpPort == 465, // true for 465, false for other ports
  auth: {
    user: config.email.smtpUser,
    pass: config.email.smtpPass,
  },
});

export const sendSuccessEmail = async (appointmentDetails, originalCallerId) => {
  if (!config.email.notificationEmail) {
    logger.warn('No notification email configured, skipping success email.');
    return;
  }

  const { contactName, companyName, confirmedPhone, appointmentTime } = appointmentDetails;

  const mailOptions = {
    from: `"1Wire Assistant" <${config.email.smtpUser}>`,
    to: config.email.notificationEmail,
    subject: `🟢 Success: Technical Assessment Scheduled with ${contactName}`,
    html: `
      <h2>New Technical Assessment Scheduled!</h2>
      <p><strong>Contact Name:</strong> ${contactName}</p>
      <p><strong>Company Name:</strong> ${companyName}</p>
      <p><strong>Appointment Time:</strong> ${appointmentTime}</p>
      <p><strong>Confirmed Phone (Verbal):</strong> ${confirmedPhone}</p>
      <p><strong>Original Caller ID:</strong> ${originalCallerId}</p>
      <hr />
      <p>Please follow up with this lead as scheduled.</p>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    logger.info(`Success email sent for ${contactName}`);
  } catch (error) {
    logger.error('Failed to send success email:', error);
  }
};

export const sendReportEmail = async (interactionDetails, originalCallerId) => {
  if (!config.email.notificationEmail) {
    logger.warn('No notification email configured, skipping report email.');
    return;
  }

  const { reason, notes, confirmedPhone } = interactionDetails;

  const mailOptions = {
    from: `"1Wire Assistant" <${config.email.smtpUser}>`,
    to: config.email.notificationEmail,
    subject: `🟠 Report: Interaction Logged (${reason})`,
    html: `
      <h2>Interaction Report</h2>
      <p><strong>Reason:</strong> ${reason}</p>
      <p><strong>Notes:</strong> ${notes}</p>
      <p><strong>Confirmed Phone (Verbal):</strong> ${confirmedPhone || 'Not provided'}</p>
      <p><strong>Original Caller ID:</strong> ${originalCallerId}</p>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    logger.info(`Report email sent for reason: ${reason}`);
  } catch (error) {
    logger.error('Failed to send report email:', error);
  }
};
