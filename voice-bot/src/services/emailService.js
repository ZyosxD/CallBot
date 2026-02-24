import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: config.email.port,
  secure: false, // true for 465, false for other ports
  auth: {
    user: config.email.user,
    pass: config.email.pass,
  },
});

export const sendAppointmentEmail = async (details) => {
  try {
    const { name, company, phone, date, time, notes, originalCallerId } = details;
    const subject = `🟢 NEW APPOINTMENT: ${company} - ${name}`;
    const html = `
      <h2>New Technical Assessment Scheduled</h2>
      <p><strong>Contact:</strong> ${name}</p>
      <p><strong>Company:</strong> ${company}</p>
      <p><strong>Verified Phone:</strong> ${phone}</p>
      <p><strong>Caller ID:</strong> ${originalCallerId || 'N/A'}</p>
      <p><strong>Date:</strong> ${date}</p>
      <p><strong>Time:</strong> ${time}</p>
      <p><strong>Notes:</strong> ${notes || 'None'}</p>
    `;

    await transporter.sendMail({
      from: config.email.user,
      to: config.email.notificationEmail,
      subject,
      html,
    });
    logger.info(`Appointment email sent for ${company}`);
  } catch (error) {
    logger.error('Error sending appointment email:', error);
  }
};

export const sendReportEmail = async (details) => {
  try {
    const { outcome, notes, originalCallerId } = details;
    const subject = `🟠 CALL REPORT: ${outcome}`;
    const html = `
      <h2>Call Report</h2>
      <p><strong>Outcome:</strong> ${outcome}</p>
      <p><strong>Caller ID:</strong> ${originalCallerId || 'N/A'}</p>
      <p><strong>Notes:</strong> ${notes || 'None'}</p>
    `;

    await transporter.sendMail({
      from: config.email.user,
      to: config.email.notificationEmail,
      subject,
      html,
    });
    logger.info(`Report email sent for outcome ${outcome}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
