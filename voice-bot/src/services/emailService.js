import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: process.env.SMTP_PORT === '465',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export const sendSuccessEmail = async (details, callerId, confirmedPhone) => {
  try {
    const subject = `🟢 SUCCESS: New Appointment Scheduled - ${details.contactName} (${details.companyName})`;

    const html = `
      <h2>New Appointment Scheduled!</h2>
      <p><strong>Contact:</strong> ${details.contactName}</p>
      <p><strong>Company:</strong> ${details.companyName}</p>
      <br />
      <p><strong>Confirmed Phone:</strong> ${confirmedPhone}</p>
      <p><strong>Original Caller ID:</strong> ${callerId}</p>
      <p><em>Do they match? ${callerId === confirmedPhone ? 'Yes' : 'No'}</em></p>
      <br />
      <p><strong>Appointment Time:</strong> ${details.appointmentTime}</p>
      <br />
      <p><strong>Notes/Interest:</strong> ${details.notes || 'N/A'}</p>
    `;

    await transporter.sendMail({
      from: `"Sarah AI" <${process.env.SMTP_USER}>`,
      to: process.env.NOTIFICATION_EMAIL,
      subject,
      html,
    });

    logger.info(`Success email sent for ${details.companyName}`);
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (details, callerId) => {
  try {
    const subject = `🟠 REPORT: Interaction without appointment - ${details.companyName || 'Unknown'}`;

    const html = `
      <h2>Interaction Report</h2>
      <p><strong>Contact:</strong> ${details.contactName || 'Unknown'}</p>
      <p><strong>Company:</strong> ${details.companyName || 'Unknown'}</p>
      <br />
      <p><strong>Caller ID:</strong> ${callerId}</p>
      <br />
      <p><strong>Outcome:</strong> ${details.outcome}</p>
      <p><strong>Notes:</strong> ${details.notes || 'N/A'}</p>
    `;

    await transporter.sendMail({
      from: `"Sarah AI" <${process.env.SMTP_USER}>`,
      to: process.env.NOTIFICATION_EMAIL,
      subject,
      html,
    });

    logger.info(`Report email sent for ${callerId}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
