import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: config.smtp.secure, // true for 465, false for other ports
  auth: {
    user: config.smtp.user,
    pass: config.smtp.pass,
  },
});

/**
 * Sends a success email (Green) when an appointment is scheduled.
 * @param {Object} data - The data collected from the call.
 * @param {string} data.callerId - The CallerID from Twilio.
 * @param {string} data.verbalPhone - The phone number confirmed verbally.
 * @param {string} data.contactName - The name of the contact.
 * @param {string} data.companyName - The name of the company.
 * @param {string} data.appointmentTime - The scheduled time.
 * @param {string} data.notes - Any additional notes or needs.
 */
export const sendSuccessEmail = async (data) => {
  try {
    const subject = `🟢 NEW APPOINTMENT: ${data.companyName} - ${data.contactName}`;
    const html = `
      <h2>New Technical Assessment Scheduled</h2>
      <p><strong>Company:</strong> ${data.companyName}</p>
      <p><strong>Contact:</strong> ${data.contactName}</p>
      <p><strong>Appointment Time:</strong> ${data.appointmentTime}</p>
      <hr>
      <h3>Phone Verification</h3>
      <p><strong>Caller ID (Twilio):</strong> ${data.callerId}</p>
      <p><strong>Verbal Confirmation:</strong> ${data.verbalPhone}</p>
      <hr>
      <h3>Notes & Needs</h3>
      <p>${data.notes || 'No specific notes recorded.'}</p>
    `;

    await transporter.sendMail({
      from: config.smtp.user,
      to: config.reportEmail,
      subject,
      html,
    });
    logger.info(`Success email sent for ${data.companyName}`);
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

/**
 * Sends a report email (Orange) for other interactions.
 * @param {Object} data - The data collected from the call.
 * @param {string} data.callerId - The CallerID from Twilio.
 * @param {string} data.verbalPhone - The phone number confirmed verbally (if any).
 * @param {string} data.outcome - The outcome of the call (e.g., Not Interested, Callback, Voicemail).
 * @param {string} data.notes - Any additional notes or needs.
 */
export const sendReportEmail = async (data) => {
  try {
    const subject = `🟠 INTERACTION REPORT: ${data.callerId} - ${data.outcome}`;
    const html = `
      <h2>Interaction Report</h2>
      <p><strong>Outcome:</strong> ${data.outcome}</p>
      <hr>
      <h3>Phone Verification</h3>
      <p><strong>Caller ID (Twilio):</strong> ${data.callerId}</p>
      <p><strong>Verbal Confirmation:</strong> ${data.verbalPhone || 'N/A'}</p>
      <hr>
      <h3>Notes & Needs</h3>
      <p>${data.notes || 'No specific notes recorded.'}</p>
    `;

    await transporter.sendMail({
      from: config.smtp.user,
      to: config.reportEmail,
      subject,
      html,
    });
    logger.info(`Report email sent for ${data.callerId}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
