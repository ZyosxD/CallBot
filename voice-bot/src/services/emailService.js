import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.smtpHost,
  port: config.email.smtpPort,
  secure: config.email.smtpPort == 465,
  auth: {
    user: config.email.smtpUser,
    pass: config.email.smtpPass,
  },
});

export const sendSuccessEmail = async (contactName, companyName, verbalPhone, appointmentTime, actualCallerId) => {
  const mailOptions = {
    from: `"1Wire Assistant" <${config.email.smtpUser}>`,
    to: config.email.notificationEmail,
    subject: `🟢 SUCCESS: Technical Assessment Scheduled - ${companyName}`,
    html: `
      <h2>New Technical Assessment Scheduled</h2>
      <p><strong>Contact Name:</strong> ${contactName}</p>
      <p><strong>Company Name:</strong> ${companyName}</p>
      <p><strong>Appointment Time:</strong> ${appointmentTime}</p>
      <hr />
      <h3>Phone Verification</h3>
      <p><strong>Verbally Confirmed Phone:</strong> ${verbalPhone}</p>
      <p><strong>Actual Caller ID:</strong> ${actualCallerId}</p>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    logger.info(`Success email sent for ${companyName}`);
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (callerId, outcome, notes) => {
  const mailOptions = {
    from: `"1Wire Assistant" <${config.email.smtpUser}>`,
    to: config.email.notificationEmail,
    subject: `🟠 REPORT: Call Outcome - ${callerId}`,
    html: `
      <h2>Call Interaction Report</h2>
      <p><strong>Caller ID:</strong> ${callerId}</p>
      <p><strong>Outcome:</strong> ${outcome}</p>
      <p><strong>Notes:</strong> ${notes}</p>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    logger.info(`Report email sent for ${callerId}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
