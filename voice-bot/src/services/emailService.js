import nodemailer from 'nodemailer';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

const transporter = nodemailer.createTransport({
  host: config.email.smtpHost,
  port: config.email.smtpPort,
  secure: false, // true for 465, false for other ports
  auth: {
    user: config.email.smtpUser,
    pass: config.email.smtpPass,
  },
});

export const sendEmailReport = async (subject, htmlContent) => {
  try {
    const toEmail = config.email.notificationEmail;
    if (!toEmail) {
      logger.warn('NOTIFICATION_EMAIL not set, skipping email.');
      return;
    }

    const info = await transporter.sendMail({
      from: `"1Wire Assistant" <${config.email.smtpUser}>`,
      to: toEmail,
      subject: subject,
      html: htmlContent,
    });

    logger.info(`Email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending email:', error);
  }
};

export const formatAppointmentEmail = (data, callerId) => {
  const subject = `🟢 SUCCESS: Technical Assessment Scheduled - ${data.companyName}`;
  const html = `
    <h2>New Appointment Scheduled</h2>
    <p><strong>Contact Name:</strong> ${data.contactName}</p>
    <p><strong>Company Name:</strong> ${data.companyName}</p>
    <p><strong>Appointment Time:</strong> ${data.appointmentTime}</p>
    <hr/>
    <h3>Phone Verification</h3>
    <p><strong>Original Caller ID:</strong> ${callerId}</p>
    <p><strong>Verbally Confirmed Phone:</strong> ${data.confirmedPhone}</p>
  `;
  return { subject, html };
};

export const formatInteractionEmail = (data, callerId) => {
  const subject = `🟠 REPORT: Call Outcome - ${data.outcome}`;
  const html = `
    <h2>Call Interaction Report</h2>
    <p><strong>Outcome:</strong> ${data.outcome}</p>
    <p><strong>Notes:</strong> ${data.notes}</p>
    <hr/>
    <p><strong>Caller ID:</strong> ${callerId}</p>
  `;
  return { subject, html };
};
