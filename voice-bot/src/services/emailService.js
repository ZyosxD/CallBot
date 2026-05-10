import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

let transporter = null;

if (config.email.host) {
  transporter = nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: config.email.port == 465,
    auth: {
      user: config.email.user,
      pass: config.email.pass
    }
  });
}

export const sendSuccessEmail = async (details, callerId) => {
  if (!transporter) return;

  const mailOptions = {
    from: config.email.from,
    to: config.email.to,
    subject: `🟢 SUCCESS: Technical Assessment Scheduled - ${details.companyName}`,
    text: `
      A new technical assessment has been scheduled successfully.

      Contact Name: ${details.name}
      Company Name: ${details.companyName}
      Confirmed Phone: ${details.phone}
      Twilio Caller ID: ${callerId}
      Date: ${details.date}
      Time: ${details.time}

      Note: The bot has verified this information verbally.
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
  if (!transporter) return;

  const mailOptions = {
    from: config.email.from,
    to: config.email.to,
    subject: `🟠 REPORT: Interaction Logged - ${callerId}`,
    text: `
      An interaction was logged (e.g. not interested, call back later, or voicemail).

      Reason: ${details.reason}
      Details: ${details.details || 'N/A'}
      Twilio Caller ID: ${callerId}
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    logger.info(`Report email sent for caller ${callerId}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
