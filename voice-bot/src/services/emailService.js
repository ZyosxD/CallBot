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

export const sendSuccessEmail = async (details, callerId, confirmedPhone) => {
  const mailOptions = {
    from: config.email.user,
    to: config.email.to,
    subject: `🟢 SUCCESS: Technical Assessment Scheduled - ${details.companyName}`,
    text: `
A new Technical Assessment has been scheduled!

Details:
Contact Name: ${details.contactName}
Company Name: ${details.companyName}
Appointment Time: ${details.appointmentTime}

Phone Comparison:
Twilio Caller ID: ${callerId}
Verbally Confirmed Phone: ${confirmedPhone}
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    logger.info('Success email sent successfully');
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (reason, callerId) => {
  const mailOptions = {
    from: config.email.user,
    to: config.email.to,
    subject: `🟠 REPORT: Interaction Finished`,
    text: `
An interaction has concluded without an appointment.

Reason: ${reason}
Twilio Caller ID: ${callerId}
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    logger.info('Report email sent successfully');
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
