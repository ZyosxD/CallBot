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

export const sendSuccessEmail = async (contactName, companyName, confirmedPhone, callerId, appointmentTime) => {
  if (!config.email.to || !config.email.user || !config.email.pass) {
    logger.warn('Email config not set, skipping success email.');
    return;
  }

  const subject = `🟢 SUCCESS: Appointment Scheduled for ${companyName}`;
  const text = `An appointment was successfully scheduled!

Contact Name: ${contactName}
Company Name: ${companyName}
Appointment Time: ${appointmentTime}

--- Phone Comparison ---
Twilio Caller ID: ${callerId}
Verbally Confirmed Phone: ${confirmedPhone}
`;

  try {
    const info = await transporter.sendMail({
      from: `"1Wire Assistant" <${config.email.user}>`,
      to: config.email.to,
      subject: subject,
      text: text,
    });
    logger.info(`Success email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (reason, callerId, summary) => {
  if (!config.email.to || !config.email.user || !config.email.pass) {
    logger.warn('Email config not set, skipping report email.');
    return;
  }

  const subject = `🟠 REPORT: Call Outcome - ${reason}`;
  const text = `A call finished without an appointment.

Reason/Outcome: ${reason}
Twilio Caller ID: ${callerId}

Summary:
${summary}
`;

  try {
    const info = await transporter.sendMail({
      from: `"1Wire Assistant" <${config.email.user}>`,
      to: config.email.to,
      subject: subject,
      text: text,
    });
    logger.info(`Report email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
