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

export const sendAppointmentEmail = async (contactName, companyName, confirmedPhone, callerId, appointmentTime, needs) => {
  try {
    const mailOptions = {
      from: config.email.from,
      to: config.email.to,
      subject: `🟢 SUCCESS: Technical Assessment Scheduled - ${companyName}`,
      text: `
A new Technical Assessment has been scheduled!

Contact Name: ${contactName}
Company Name: ${companyName}
Appointment Time: ${appointmentTime}

Phone Verification:
- Verbally Confirmed Phone: ${confirmedPhone}
- Original Caller ID: ${callerId}

Detected Needs/Notes:
${needs || 'N/A'}
      `
    };

    const info = await transporter.sendMail(mailOptions);
    logger.info(`Appointment email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending appointment email:', error);
  }
};

export const sendReportEmail = async (reason, callerId, notes) => {
  try {
    const mailOptions = {
      from: config.email.from,
      to: config.email.to,
      subject: `🟠 REPORT: Interaction Logged - ${callerId}`,
      text: `
An interaction was logged.

Original Caller ID: ${callerId}
Reason/Status: ${reason}

Notes:
${notes || 'N/A'}
      `
    };

    const info = await transporter.sendMail(mailOptions);
    logger.info(`Report email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
