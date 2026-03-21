import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.smtpHost,
  port: config.email.smtpPort,
  secure: config.email.smtpPort === 465, // true for 465, false for other ports
  auth: {
    user: config.email.smtpUser,
    pass: config.email.smtpPass
  }
});

export const sendSuccessEmail = async (contactName, companyName, twilioCallerId, confirmedPhone, appointmentTime) => {
  const mailOptions = {
    from: config.email.smtpUser,
    to: config.email.notifyTo,
    subject: `🟢 SUCCESS: Technical Assessment Scheduled - ${companyName}`,
    html: `
      <h2>New Technical Assessment Scheduled!</h2>
      <p><strong>Company:</strong> ${companyName}</p>
      <p><strong>Contact Name:</strong> ${contactName}</p>
      <hr />
      <h3>Phone Verification</h3>
      <p><strong>Twilio Caller ID:</strong> ${twilioCallerId}</p>
      <p><strong>Verbally Confirmed Phone:</strong> ${confirmedPhone}</p>
      <hr />
      <h3>Appointment Details</h3>
      <p><strong>Time:</strong> ${appointmentTime}</p>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    logger.info(`Success email sent for ${companyName}`);
  } catch (error) {
    logger.error(`Error sending success email for ${companyName}:`, error);
  }
};

export const sendReportEmail = async (twilioCallerId, interactionReason, details) => {
  const mailOptions = {
    from: config.email.smtpUser,
    to: config.email.notifyTo,
    subject: `🟠 REPORT: Call Interaction - ${interactionReason}`,
    html: `
      <h2>Call Interaction Report</h2>
      <p><strong>Twilio Caller ID:</strong> ${twilioCallerId}</p>
      <p><strong>Reason:</strong> ${interactionReason}</p>
      <p><strong>Details:</strong> ${details}</p>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    logger.info(`Report email sent for ${twilioCallerId}`);
  } catch (error) {
    logger.error(`Error sending report email for ${twilioCallerId}:`, error);
  }
};
