import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

let transporter;

if (config.email.smtp.host) {
  transporter = nodemailer.createTransport({
    host: config.email.smtp.host,
    port: config.email.smtp.port,
    secure: config.email.smtp.port == 465, // true for 465, false for other ports
    auth: {
      user: config.email.smtp.user,
      pass: config.email.smtp.pass,
    },
  });
}

export const sendEmail = async (subject, htmlContent) => {
  if (!transporter) {
    logger.warn('Email transporter not configured. Cannot send email.');
    return;
  }

  try {
    const info = await transporter.sendMail({
      from: `"1Wire Assistant" <${config.email.smtp.user}>`,
      to: config.email.notificationEmail,
      subject: subject,
      html: htmlContent,
    });
    logger.info(`Email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending email:', error);
  }
};

export const sendSuccessEmail = async (data) => {
  const subject = `🟢 Success: Technical Assessment Scheduled - ${data.companyName}`;
  const htmlContent = `
    <h2>New Technical Assessment Scheduled</h2>
    <p><strong>Contact Name:</strong> ${data.contactName}</p>
    <p><strong>Company Name:</strong> ${data.companyName}</p>
    <p><strong>Confirmed Phone:</strong> ${data.confirmedPhone}</p>
    <p><strong>Caller ID (Twilio):</strong> ${data.callerId}</p>
    <p><strong>Appointment Time:</strong> ${data.appointmentTime}</p>
    <br/>
    <p><em>This call was handled by Sarah (1Wire Assistant).</em></p>
  `;
  await sendEmail(subject, htmlContent);
};

export const sendReportEmail = async (data) => {
  const subject = `🟠 Report: Call Interaction - ${data.status}`;
  const htmlContent = `
    <h2>Call Interaction Report</h2>
    <p><strong>Status/Outcome:</strong> ${data.status}</p>
    <p><strong>Caller ID (Twilio):</strong> ${data.callerId}</p>
    <p><strong>Notes:</strong> ${data.notes || 'N/A'}</p>
    <br/>
    <p><em>This call was handled by Sarah (1Wire Assistant).</em></p>
  `;
  await sendEmail(subject, htmlContent);
};
