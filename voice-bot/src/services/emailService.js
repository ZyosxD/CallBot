import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: config.email.port,
  secure: false, // true for 465, false for other ports
  auth: {
    user: config.email.user,
    pass: config.email.pass
  }
});

export const sendSuccessEmail = async (client, details) => {
  const subject = `🟢 NEW APPOINTMENT - ${client.name}`;
  const html = `
    <h2>New Technical Assessment Scheduled!</h2>
    <p><strong>Company:</strong> ${client.name}</p>
    <p><strong>Contact Name:</strong> ${details.contactName}</p>
    <p><strong>Appointment Time:</strong> ${details.appointmentTime}</p>
    <hr>
    <h3>Phone Number Check</h3>
    <p><strong>Twilio Caller ID:</strong> ${client.phone}</p>
    <p><strong>Verbally Confirmed:</strong> ${details.phoneNumber}</p>
    <hr>
    <h3>Notes</h3>
    <p>${details.notes || 'No specific notes.'}</p>
  `;

  try {
    await transporter.sendMail({
      from: config.email.user,
      to: config.email.notificationEmail,
      subject,
      html
    });
    logger.info(`Success email sent for ${client.name}`);
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (client, details) => {
  const subject = `🟠 CALL REPORT - ${client.name}`;
  const html = `
    <h2>Call Interaction Report</h2>
    <p><strong>Company:</strong> ${client.name}</p>
    <p><strong>Outcome:</strong> ${details.outcome}</p>
    <hr>
    <h3>Phone Number Check</h3>
    <p><strong>Twilio Caller ID:</strong> ${client.phone}</p>
    <hr>
    <h3>Notes</h3>
    <p>${details.notes || 'No specific notes.'}</p>
  `;

  try {
    await transporter.sendMail({
      from: config.email.user,
      to: config.email.notificationEmail,
      subject,
      html
    });
    logger.info(`Report email sent for ${client.name}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
