import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const createTransporter = () => {
  return nodemailer.createTransport({
    host: config.email.smtpHost,
    port: parseInt(config.email.smtpPort || '587', 10),
    secure: parseInt(config.email.smtpPort || '587', 10) === 465, // true for 465, false for other ports
    auth: {
      user: config.email.smtpUser,
      pass: config.email.smtpPass,
    },
  });
};

export const sendSuccessEmail = async (appointmentDetails) => {
  const { contactName, companyName, confirmedPhone, appointmentTime, originalCallerId } = appointmentDetails;
  const transporter = createTransporter();

  const mailOptions = {
    from: config.email.smtpUser,
    to: config.email.notificationEmail,
    subject: `🟢 Success: Technical Assessment Scheduled - ${companyName}`,
    html: `
      <h2>Technical Assessment Scheduled</h2>
      <p><strong>Contact Name:</strong> ${contactName}</p>
      <p><strong>Company Name:</strong> ${companyName}</p>
      <p><strong>Confirmed Phone:</strong> ${confirmedPhone}</p>
      <p><strong>Twilio Caller ID:</strong> ${originalCallerId}</p>
      <p><strong>Appointment Time:</strong> ${appointmentTime}</p>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    logger.info(`Success Email sent: ${info.messageId}`);
    return true;
  } catch (error) {
    logger.error('Error sending success email:', error);
    return false;
  }
};

export const sendReportEmail = async (reportDetails) => {
  const { summary, interactionResult, originalCallerId } = reportDetails;
  const transporter = createTransporter();

  const mailOptions = {
    from: config.email.smtpUser,
    to: config.email.notificationEmail,
    subject: `🟠 Report: Call Interaction Result`,
    html: `
      <h2>Call Interaction Report</h2>
      <p><strong>Result:</strong> ${interactionResult}</p>
      <p><strong>Twilio Caller ID:</strong> ${originalCallerId}</p>
      <p><strong>Summary:</strong> ${summary}</p>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    logger.info(`Report Email sent: ${info.messageId}`);
    return true;
  } catch (error) {
    logger.error('Error sending report email:', error);
    return false;
  }
};
