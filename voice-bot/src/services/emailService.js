import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: config.email.port,
  auth: {
    user: config.email.user,
    pass: config.email.pass
  }
});

export const sendSuccessEmail = async (details, callerId) => {
  const subject = '🟢 SUCCESS: New Appointment Scheduled';
  const html = `
    <h2>New Appointment Confirmed</h2>
    <p><strong>Contact Name:</strong> ${details.name}</p>
    <p><strong>Company Name:</strong> ${details.company}</p>
    <p><strong>Verified Phone:</strong> ${details.verifiedPhone}</p>
    <p><strong>Twilio Caller ID:</strong> ${callerId}</p>
    <p><strong>Exact Time:</strong> ${details.time}</p>
  `;

  try {
    await transporter.sendMail({
      from: config.email.from,
      to: config.email.to,
      subject,
      html
    });
    logger.info('Success email sent');
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (details, callerId) => {
  const subject = '🟠 REPORT: Interaction Finished';
  const html = `
    <h2>Interaction Report</h2>
    <p><strong>Notes:</strong> ${details.notes}</p>
    <p><strong>Twilio Caller ID:</strong> ${callerId}</p>
  `;

  try {
    await transporter.sendMail({
      from: config.email.from,
      to: config.email.to,
      subject,
      html
    });
    logger.info('Report email sent');
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
