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

export const sendSuccessEmail = async (contactName, companyName, callerId, confirmedPhone, time, extraDetails) => {
  try {
    const mailOptions = {
      from: `"1Wire Sarah" <${config.email.user}>`,
      to: config.email.to,
      subject: `🟢 SUCCESS: Technical Assessment Scheduled - ${companyName}`,
      text: `
A new Technical Assessment has been scheduled!

Details:
- Contact Name: ${contactName}
- Company Name: ${companyName}
- Caller ID: ${callerId}
- Confirmed Phone: ${confirmedPhone}
- Scheduled Time: ${time}

Extra Details:
${extraDetails}
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    logger.info(`Success email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (callerId, status, details) => {
  try {
    const mailOptions = {
      from: `"1Wire Sarah" <${config.email.user}>`,
      to: config.email.to,
      subject: `🟠 REPORT: Interaction Update - ${callerId}`,
      text: `
Call interaction report:

- Caller ID: ${callerId}
- Status: ${status}

Details:
${details}
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    logger.info(`Report email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
