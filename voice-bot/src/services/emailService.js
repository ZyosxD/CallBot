import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

let transporter;

const getTransporter = () => {
  if (!transporter) {
    if (!config.email.host || !config.email.user || !config.email.pass) {
        logger.warn('Email configuration is missing. Emails will not be sent.');
        return null;
    }
    transporter = nodemailer.createTransport({
      host: config.email.host,
      port: config.email.port,
      secure: config.email.port === 465, // true for 465, false for other ports
      auth: {
        user: config.email.user,
        pass: config.email.pass,
      },
    });
  }
  return transporter;
};

export const sendSuccessEmail = async (clientPhone, confirmedPhone, data) => {
  const mailTransporter = getTransporter();
  if (!mailTransporter) return;

  const mailOptions = {
    from: `"Sarah 1Wire" <${config.email.user}>`,
    to: config.email.notificationAddress,
    subject: `🟢 SUCCESS: Technical Assessment Scheduled - ${data.companyName}`,
    text: `
New Technical Assessment Scheduled!

Contact Details:
- Contact Name: ${data.contactName}
- Company Name: ${data.companyName}
- Twilio CallerID: ${clientPhone}
- Confirmed Phone: ${confirmedPhone}
- Scheduled Time: ${data.appointmentTime}

Notes:
This lead has been successfully scheduled by Sarah for a Technical Assessment. Please review and prepare for the call.
    `,
  };

  try {
    const info = await mailTransporter.sendMail(mailOptions);
    logger.info(`Success Email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (clientPhone, reason) => {
  const mailTransporter = getTransporter();
  if (!mailTransporter) return;

  const mailOptions = {
    from: `"Sarah 1Wire" <${config.email.user}>`,
    to: config.email.notificationAddress,
    subject: `🟠 REPORT: Interaction Logged - ${clientPhone}`,
    text: `
Interaction Report

Details:
- Twilio CallerID: ${clientPhone}
- Reason/Status: ${reason}

Notes:
This interaction did not result in a scheduled appointment.
    `,
  };

  try {
    const info = await mailTransporter.sendMail(mailOptions);
    logger.info(`Report Email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
