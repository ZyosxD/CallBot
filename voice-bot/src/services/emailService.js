import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.smtp.host,
  port: parseInt(config.smtp.port) || 587,
  secure: parseInt(config.smtp.port) === 465,
  auth: {
    user: config.smtp.user,
    pass: config.smtp.pass,
  },
});

export const sendSuccessEmail = async (leadData) => {
  try {
    const { name, company, phone, confirmedPhone, appointmentTime, needs } = leadData;
    const subject = `🟢 SUCCESS: Appointment Scheduled - ${company || 'Unknown Company'}`;
    const text = `
      SUCCESSFUL APPOINTMENT

      Contact Name: ${name}
      Company: ${company}
      Caller ID: ${phone}
      Confirmed Phone: ${confirmedPhone}
      Appointment Time: ${appointmentTime}

      Needs Identified: ${needs}
    `;

    await transporter.sendMail({
      from: config.smtp.user,
      to: config.notificationEmail,
      subject,
      text,
    });
    logger.info(`Success email sent for ${company || phone}`);
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (reportData) => {
  try {
    const { phone, reason, notes } = reportData;
    const subject = `🟠 REPORT: Interaction Log - ${phone}`;
    const text = `
      INTERACTION REPORT

      Phone: ${phone}
      Reason: ${reason}
      Notes: ${notes}
    `;

    await transporter.sendMail({
      from: config.smtp.user,
      to: config.notificationEmail,
      subject,
      text,
    });
    logger.info(`Report email sent for ${phone}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
