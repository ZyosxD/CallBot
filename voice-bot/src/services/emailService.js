import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: Number(config.smtp.port) === 465,
  auth: {
    user: config.smtp.user,
    pass: config.smtp.pass,
  },
});

export const sendSuccessEmail = async (details, originalPhone) => {
  try {
    const { name, company, phone, date, time } = details;
    const subject = `🟢 New Lead: ${company} - ${name}`;
    const html = `
      <h1>New Appointment Scheduled! 🎉</h1>
      <p><strong>Contact Name:</strong> ${name}</p>
      <p><strong>Company:</strong> ${company}</p>
      <p><strong>Confirmed Phone:</strong> ${phone}</p>
      <p><strong>Original Caller ID:</strong> ${originalPhone || 'N/A'}</p>
      <p><strong>Requested Time:</strong> ${date} at ${time}</p>
    `;

    await transporter.sendMail({
      from: config.smtp.user,
      to: config.smtp.notificationEmail,
      subject,
      html,
    });
    logger.info(`Success email sent for ${company}`);
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (details) => {
  try {
    const { phone, status, reason } = details;
    const subject = `🟠 Interaction Report: ${phone}`;
    const html = `
      <h1>Call Interaction Report</h1>
      <p><strong>Phone:</strong> ${phone}</p>
      <p><strong>Status:</strong> ${status}</p>
      <p><strong>Notes/Reason:</strong> ${reason}</p>
    `;

    await transporter.sendMail({
      from: config.smtp.user,
      to: config.smtp.notificationEmail,
      subject,
      html,
    });
    logger.info(`Report email sent for ${phone}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
