import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const createTransporter = () => {
  return nodemailer.createTransport({
    host: config.email.host,
    port: parseInt(config.email.port, 10),
    secure: parseInt(config.email.port, 10) === 465,
    auth: {
      user: config.email.user,
      pass: config.email.pass
    }
  });
};

export const sendSuccessEmail = async (details, callerId) => {
  try {
    const transporter = createTransporter();

    const mailOptions = {
      from: config.email.user,
      to: config.email.notificationEmail,
      subject: '🟢 SUCCESS: New Technical Assessment Scheduled',
      html: `
        <h2>New Technical Assessment Scheduled</h2>
        <p><strong>Contact Name:</strong> ${details.contactName}</p>
        <p><strong>Company Name:</strong> ${details.companyName}</p>
        <p><strong>Appointment Time:</strong> ${details.appointmentTime}</p>
        <p><strong>Confirmed Phone (Verbal):</strong> ${details.confirmedPhone}</p>
        <p><strong>Original Caller ID:</strong> ${callerId || 'Unknown'}</p>
      `
    };

    await transporter.sendMail(mailOptions);
    logger.info('Success email sent successfully');
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (details, callerId) => {
  try {
    const transporter = createTransporter();

    const mailOptions = {
      from: config.email.user,
      to: config.email.notificationEmail,
      subject: '🟠 REPORT: Call Interaction Details',
      html: `
        <h2>Call Interaction Report</h2>
        <p><strong>Status/Outcome:</strong> ${details.outcome}</p>
        <p><strong>Notes/Details:</strong> ${details.notes}</p>
        <p><strong>Original Caller ID:</strong> ${callerId || 'Unknown'}</p>
      `
    };

    await transporter.sendMail(mailOptions);
    logger.info('Report email sent successfully');
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
