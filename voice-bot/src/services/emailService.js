import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: config.email.port,
  secure: config.email.secure,
  auth: {
    user: config.email.auth.user,
    pass: config.email.auth.pass
  }
});

export const sendSuccessEmail = async (details, callerId) => {
  const mailOptions = {
    from: config.email.auth.user,
    to: config.email.to,
    subject: `🟢 SUCCESS: Technical Assessment Scheduled - ${details.companyName}`,
    text: `A new Technical Assessment has been scheduled!

Company: ${details.companyName}
Contact Name: ${details.contactName}
Appointment Time: ${details.appointmentTime}

Phone Verification:
- Twilio Caller ID: ${callerId}
- Confirmed Phone: ${details.confirmedPhone}
`
  };

  try {
    await transporter.sendMail(mailOptions);
    logger.info(`Success email sent for ${details.companyName}`);
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (details, callerId) => {
  const mailOptions = {
    from: config.email.auth.user,
    to: config.email.to,
    subject: `🟠 REPORT: Interaction Logged`,
    text: `An interaction has been logged.

Details:
${details.summary}

Phone Verification:
- Twilio Caller ID: ${callerId}
`
  };

  try {
    await transporter.sendMail(mailOptions);
    logger.info(`Report email sent for caller ${callerId}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
