import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: config.email.port,
  secure: config.email.secure,
  auth: {
    user: config.email.user,
    pass: config.email.pass
  }
});

export const sendEmail = async (subject, htmlContent) => {
  try {
    const mailOptions = {
      from: config.email.from,
      to: config.email.to,
      subject,
      html: htmlContent
    };
    await transporter.sendMail(mailOptions);
    logger.info(`Email sent successfully: ${subject}`);
  } catch (error) {
    logger.error('Error sending email:', error);
  }
};

export const sendSuccessEmail = async (data) => {
  const subject = `🟢 SUCCESS: Technical Assessment Scheduled - ${data.companyName}`;
  const html = `
    <h2>Technical Assessment Scheduled</h2>
    <p><strong>Contact Name:</strong> ${data.contactName}</p>
    <p><strong>Company Name:</strong> ${data.companyName}</p>
    <p><strong>Caller ID (Original):</strong> ${data.callerId}</p>
    <p><strong>Confirmed Phone (Verbal):</strong> ${data.confirmedPhone}</p>
    <p><strong>Appointment Time:</strong> ${data.appointmentTime}</p>
  `;
  await sendEmail(subject, html);
};

export const sendReportEmail = async (data) => {
  const subject = `🟠 REPORT: Interaction Logged - ${data.callerId}`;
  const html = `
    <h2>Call Interaction Report</h2>
    <p><strong>Caller ID:</strong> ${data.callerId}</p>
    <p><strong>Reason:</strong> ${data.reason}</p>
    <p><strong>Details:</strong> ${data.details || 'N/A'}</p>
  `;
  await sendEmail(subject, html);
};
