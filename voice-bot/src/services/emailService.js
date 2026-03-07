import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.smtp.host || 'smtp.gmail.com',
  port: config.smtp.port || 587,
  secure: false, // true for 465, false for other ports
  auth: {
    user: config.smtp.user,
    pass: config.smtp.pass,
  },
});

const sendEmail = async (subject, text, html) => {
  try {
    if (!config.email.notificationEmail) {
      logger.warn('Notification email not configured. Skipping email send.');
      return;
    }

    const info = await transporter.sendMail({
      from: `"1Wire Assistant" <${config.smtp.user}>`,
      to: config.email.notificationEmail,
      subject,
      text,
      html,
    });

    logger.info(`Email sent: ${info.messageId}`);
  } catch (error) {
    logger.error(`Error sending email: ${error.message}`);
  }
};

export const sendSuccessReport = async (data) => {
  const { contactName, companyName, confirmedPhone, callerId, appointmentTime, notes } = data;

  const subject = `🟢 SUCCESS: Technical Assessment Scheduled - ${companyName}`;

  let phoneComparison = '';
  if (callerId && confirmedPhone && callerId !== confirmedPhone) {
    phoneComparison = `<p><strong>⚠️ Note:</strong> The confirmed phone (${confirmedPhone}) differs from the Caller ID (${callerId}).</p>`;
  }

  const html = `
    <h2>New Appointment Scheduled!</h2>
    <p><strong>Company:</strong> ${companyName}</p>
    <p><strong>Contact Name:</strong> ${contactName}</p>
    <p><strong>Confirmed Phone:</strong> ${confirmedPhone}</p>
    <p><strong>Caller ID:</strong> ${callerId || 'Unknown'}</p>
    <p><strong>Appointment Time:</strong> ${appointmentTime}</p>
    ${phoneComparison}
    <h3>Notes from Conversation:</h3>
    <p>${notes || 'No specific notes recorded.'}</p>
  `;

  await sendEmail(subject, 'New appointment scheduled', html);
};

export const sendInteractionReport = async (data) => {
  const { callerId, reason, notes } = data;

  const subject = `🟠 REPORT: Interaction Logged - ${callerId}`;

  const html = `
    <h2>Interaction Report</h2>
    <p><strong>Caller ID:</strong> ${callerId || 'Unknown'}</p>
    <p><strong>Reason/Outcome:</strong> ${reason}</p>
    <h3>Notes:</h3>
    <p>${notes || 'No specific notes recorded.'}</p>
  `;

  await sendEmail(subject, 'Interaction logged', html);
};
