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
  const { name, company, verbalPhone, callerId, date, time, needs } = details;

  const subject = `✅ NEW APPOINTMENT: ${company} - ${name}`;
  const html = `
    <h2>✅ Appointment Scheduled</h2>
    <p><strong>Contact:</strong> ${name}</p>
    <p><strong>Company:</strong> ${company}</p>
    <p><strong>Date:</strong> ${date}</p>
    <p><strong>Time:</strong> ${time}</p>
    <hr>
    <h3>📞 Phone Verification</h3>
    <p><strong>Verbal Phone:</strong> ${verbalPhone}</p>
    <p><strong>Caller ID:</strong> ${callerId}</p>
    <hr>
    <h3>📝 Needs Detected</h3>
    <p>${needs}</p>
  `;

  try {
    await transporter.sendMail({
      from: config.email.user,
      to: config.email.notificationEmail,
      subject,
      html,
    });
    logger.info('Success email sent');
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (details) => {
  const { name, company, callerId, outcome, notes } = details;

  const subject = `⚠️ INTERACTION REPORT: ${company || 'Unknown'} - ${outcome}`;
  const html = `
    <h2>⚠️ Interaction Report</h2>
    <p><strong>Contact:</strong> ${name || 'Unknown'}</p>
    <p><strong>Company:</strong> ${company || 'Unknown'}</p>
    <p><strong>Caller ID:</strong> ${callerId}</p>
    <p><strong>Outcome:</strong> ${outcome}</p>
    <hr>
    <h3>📝 Notes</h3>
    <p>${notes}</p>
  `;

  try {
    await transporter.sendMail({
      from: config.email.user,
      to: config.email.notificationEmail,
      subject,
      html,
    });
    logger.info('Report email sent');
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
