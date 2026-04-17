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

export const sendSuccessEmail = async (details) => {
  const { contactName, companyName, confirmedPhone, callerId, appointmentTime, needs } = details;
  const mailOptions = {
    from: config.email.from,
    to: config.email.to,
    subject: '🟢 SUCCESS: New Technical Assessment Scheduled',
    text: `
      Great news! A new Technical Assessment has been scheduled.

      Company: ${companyName}
      Contact: ${contactName}
      Appointment Time: ${appointmentTime}

      Phone Comparison:
      - Twilio CallerID: ${callerId}
      - Verbally Confirmed Phone: ${confirmedPhone}

      Needs/Notes: ${needs}
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    logger.info('Success email sent successfully');
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (details) => {
  const { callerId, status, reason } = details;
  const mailOptions = {
    from: config.email.from,
    to: config.email.to,
    subject: '🟠 REPORT: Call Interaction Report',
    text: `
      An interaction report has been generated.

      Phone Number: ${callerId}
      Status: ${status}
      Reason/Notes: ${reason}
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    logger.info('Report email sent successfully');
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
