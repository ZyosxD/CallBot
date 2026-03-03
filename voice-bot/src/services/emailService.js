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

export const sendSuccessEmail = async (contactName, companyName, confirmedPhone, callerId, appointmentTime) => {
  const subject = `🟢 Success: Appointment Scheduled for ${companyName}`;
  const html = `
    <h2>New Technical Assessment Scheduled</h2>
    <p><strong>Company:</strong> ${companyName}</p>
    <p><strong>Contact:</strong> ${contactName}</p>
    <p><strong>Time:</strong> ${appointmentTime}</p>
    <hr/>
    <h3>Phone Verification</h3>
    <p><strong>Verbal Confirmation:</strong> ${confirmedPhone}</p>
    <p><strong>Caller ID (Twilio):</strong> ${callerId}</p>
    <p><em>${confirmedPhone === callerId ? 'Match: Verified' : 'Mismatch: Needs attention'}</em></p>
  `;

  try {
    const info = await transporter.sendMail({
      from: `"1Wire Assistant" <${config.email.smtpUser}>`,
      to: config.email.notificationEmail,
      subject: subject,
      html: html,
    });
    logger.info(`Success Email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (reason, callerId) => {
  const subject = `🟠 Report: Interaction Logged (${reason})`;
  const html = `
    <h2>Interaction Report</h2>
    <p><strong>Reason:</strong> ${reason}</p>
    <p><strong>Caller ID (Twilio):</strong> ${callerId}</p>
  `;

  try {
    const info = await transporter.sendMail({
      from: `"1Wire Assistant" <${config.email.smtpUser}>`,
      to: config.email.notificationEmail,
      subject: subject,
      html: html,
    });
    logger.info(`Report Email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
