import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: config.email.port,
  secure: config.email.port == 465, // true for 465, false for other ports
  auth: {
    user: config.email.user,
    pass: config.email.pass,
  },
});

export const sendSuccessEmail = async (leadData) => {
  try {
    const { contactName, companyName, confirmedPhone, callerId, appointmentTime } = leadData;

    const mailOptions = {
      from: config.email.user,
      to: config.email.to,
      subject: '🟢 SUCCESS: New Technical Assessment Scheduled!',
      text: `
A new Technical Assessment has been scheduled!

Details:
Contact Name: ${contactName}
Company Name: ${companyName}
Appointment Time: ${appointmentTime}

Phone Verification:
Verbally Confirmed Phone: ${confirmedPhone}
Twilio Caller ID: ${callerId}
      `,
    };

    await transporter.sendMail(mailOptions);
    logger.info(`Success email sent for lead: ${companyName}`);
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (interactionData) => {
  try {
    const { reason, callerId, notes } = interactionData;

    const mailOptions = {
      from: config.email.user,
      to: config.email.to,
      subject: '🟠 REPORT: Call Interaction Logged',
      text: `
An interaction has been logged.

Details:
Reason: ${reason}
Twilio Caller ID: ${callerId}
Notes: ${notes || 'None'}
      `,
    };

    await transporter.sendMail(mailOptions);
    logger.info(`Report email sent for caller: ${callerId}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
