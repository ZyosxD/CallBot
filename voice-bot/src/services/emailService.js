import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.smtpHost,
  port: config.email.smtpPort,
  secure: false, // true for 465, false for other ports
  auth: {
    user: config.email.smtpUser,
    pass: config.email.smtpPass,
  },
});

export const sendSuccessEmail = async (details) => {
  const { contactName, companyName, confirmedPhone, appointmentTime, callerId } = details;

  const subject = `🟢 Success: Appointment Scheduled - ${companyName}`;
  const html = `
    <h2>New Technical Assessment Scheduled</h2>
    <p><strong>Company:</strong> ${companyName}</p>
    <p><strong>Contact:</strong> ${contactName}</p>
    <p><strong>Appointment Time:</strong> ${appointmentTime}</p>
    <hr>
    <h3>Phone Verification</h3>
    <p><strong>Twilio Caller ID:</strong> ${callerId}</p>
    <p><strong>Confirmed Phone:</strong> ${confirmedPhone}</p>
    <p><em>(Please verify if they match or if a different number was provided)</em></p>
  `;

  try {
    const info = await transporter.sendMail({
      from: config.email.smtpUser,
      to: config.email.notificationEmail,
      subject,
      html,
    });
    logger.info(`Success email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (details) => {
  const { result, notes, callerId } = details;

  const subject = `🟠 Report: Interaction Logged - ${result}`;
  const html = `
    <h2>Interaction Report</h2>
    <p><strong>Result:</strong> ${result}</p>
    <p><strong>Notes:</strong> ${notes}</p>
    <hr>
    <h3>Caller Info</h3>
    <p><strong>Caller ID:</strong> ${callerId}</p>
  `;

  try {
    const info = await transporter.sendMail({
      from: config.email.smtpUser,
      to: config.email.notificationEmail,
      subject,
      html,
    });
    logger.info(`Report email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
