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

export const sendSuccessEmail = async (data) => {
  if (!config.email.user || !config.email.to) {
    logger.warn('Email config missing, skipping success email');
    return;
  }

  try {
    const info = await transporter.sendMail({
      from: `"Sarah Assistant" <${config.email.user}>`,
      to: config.email.to,
      subject: "🟢 SUCCESS: New Technical Assessment Scheduled",
      text: `We have a new appointment!

Contact Name: ${data.contactName}
Company Name: ${data.companyName}
Appointment Time: ${data.appointmentTime}

--- Phone Verification ---
Original Caller ID: ${data.callerId}
Verbally Confirmed Phone: ${data.confirmedPhone}
Match: ${data.callerId === data.confirmedPhone ? 'Yes' : 'No'}
--------------------------

Needs Detected: ${data.needs || 'N/A'}
`,
    });
    logger.info(`Success email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (data) => {
  if (!config.email.user || !config.email.to) {
    logger.warn('Email config missing, skipping report email');
    return;
  }

  try {
    const info = await transporter.sendMail({
      from: `"Sarah Assistant" <${config.email.user}>`,
      to: config.email.to,
      subject: "🟠 REPORT: Interaction Logged",
      text: `An interaction was reported.

Reason: ${data.reason}
Notes: ${data.notes || 'N/A'}

--- Phone Verification ---
Original Caller ID: ${data.callerId}
--------------------------
`,
    });
    logger.info(`Report email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
