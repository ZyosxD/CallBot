import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.smtpHost,
  port: config.email.smtpPort,
  auth: {
    user: config.email.smtpUser,
    pass: config.email.smtpPass
  }
});

export const sendSuccessEmail = async (details) => {
  const mailOptions = {
    from: config.email.fromAddress,
    to: config.email.toAddress,
    subject: `🟢 SUCCESS - Technical Assessment Scheduled - ${details.companyName}`,
    text: `
We have successfully scheduled a Technical Assessment!

Contact Name: ${details.contactName}
Company Name: ${details.companyName}
Appointment Time: ${details.appointmentTime}

Caller ID from Twilio: ${details.callerId}
Verbally Confirmed Phone: ${details.confirmedPhone}

Notes:
${details.notes || 'None'}
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    logger.info('Success email sent successfully.');
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (details) => {
  const mailOptions = {
    from: config.email.fromAddress,
    to: config.email.toAddress,
    subject: `🟠 REPORT - Interaction Logged - ${details.contactName || 'Unknown'}`,
    text: `
An interaction was logged that did not result in an appointment.

Contact Name: ${details.contactName || 'Unknown'}
Caller ID from Twilio: ${details.callerId}
Reason: ${details.reason}

Notes:
${details.notes || 'None'}
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    logger.info('Report email sent successfully.');
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
