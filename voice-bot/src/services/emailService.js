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

export const sendSuccessEmail = async (contactName, companyName, confirmedPhone, appointmentTime, originalCallerId) => {
  const mailOptions = {
    from: config.email.user,
    to: config.email.to,
    subject: `🟢 SUCCESS - Appointment Scheduled for ${companyName}`,
    text: `
An appointment has been successfully scheduled.

Contact Name: ${contactName}
Company Name: ${companyName}
Exact Time: ${appointmentTime}
Confirmed Phone: ${confirmedPhone}
Original Caller ID: ${originalCallerId}

Best,
Sarah (1Wire Assistant)
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    logger.info(`Success email sent for ${companyName}`);
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (interactionLog) => {
  const mailOptions = {
    from: config.email.user,
    to: config.email.to,
    subject: `🟠 REPORT - Interaction Log`,
    text: `
A new interaction report has been generated.

Details:
${interactionLog}

Best,
Sarah (1Wire Assistant)
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    logger.info(`Report email sent.`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
