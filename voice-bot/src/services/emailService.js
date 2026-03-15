import nodemailer from 'nodemailer';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

const transporter = nodemailer.createTransport({
  host: config.email.smtpHost,
  port: parseInt(config.email.smtpPort, 10),
  secure: parseInt(config.email.smtpPort, 10) === 465,
  auth: {
    user: config.email.smtpUser,
    pass: config.email.smtpPass
  }
});

export const sendSuccessEmail = async (contactName, companyName, originalPhone, confirmedPhone, appointmentTime, additionalNotes) => {
  const mailOptions = {
    from: config.email.smtpUser,
    to: config.email.notificationEmail,
    subject: '🟢 SUCCESS: Appointment Scheduled - 1Wire',
    text: `
An appointment has been successfully scheduled!

Details:
Contact Name: ${contactName}
Company Name: ${companyName}
Original Caller ID: ${originalPhone}
Confirmed Phone: ${confirmedPhone}
Appointment Time: ${appointmentTime}

Additional Notes:
${additionalNotes || 'N/A'}
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    logger.info('Success email sent.');
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (originalPhone, summary, reason) => {
  const mailOptions = {
    from: config.email.smtpUser,
    to: config.email.notificationEmail,
    subject: '🟠 REPORT: Interaction Log - 1Wire',
    text: `
Interaction logged without an appointment.

Details:
Original Caller ID: ${originalPhone}
Reason: ${reason}

Summary:
${summary}
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    logger.info('Report email sent.');
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
