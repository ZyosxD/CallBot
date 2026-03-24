import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  service: config.email.service,
  auth: {
    user: config.email.user,
    pass: config.email.pass
  }
});

export const sendSuccessEmail = async (data) => {
  const subject = `🟢 SUCCESS: Technical Assessment Scheduled - ${data.companyName}`;
  const text = `
    A new Technical Assessment has been scheduled!

    Company: ${data.companyName}
    Contact: ${data.contactName}
    Caller ID: ${data.callerId}
    Confirmed Phone: ${data.confirmedPhone}
    Appointment Time: ${data.appointmentTime}

    Notes: Lead confirmed via Sarah (AI Assistant).
  `;

  try {
    await transporter.sendMail({
      from: config.email.user,
      to: config.email.to,
      subject,
      text
    });
    logger.info(`Success email sent for ${data.companyName}`);
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (data) => {
  const subject = `🟠 REPORT: Interaction Logged - ${data.callerId}`;
  const text = `
    An interaction was logged.

    Caller ID: ${data.callerId}
    Status: ${data.status}
    Reason: ${data.reason}

    Notes: Processed via Sarah (AI Assistant).
  `;

  try {
    await transporter.sendMail({
      from: config.email.user,
      to: config.email.to,
      subject,
      text
    });
    logger.info(`Report email sent for ${data.callerId}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
