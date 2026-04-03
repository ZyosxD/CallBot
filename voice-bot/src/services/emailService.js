import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

let transporter = null;

if (config.email.user && config.email.pass) {
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

export const sendSuccessEmail = async (appointmentData, originalCallerId) => {
  if (!transporter || !config.email.to) {
    logger.warn('Email config missing, skipping success email');
    return;
  }

  const { contactName, companyName, confirmedPhone, appointmentTime } = appointmentData;
  const matchStatus = originalCallerId === confirmedPhone ? 'MATCH' : 'MISMATCH';

  const mailOptions = {
    from: `"Sarah (1Wire Assistant)" <${config.email.user}>`,
    to: config.email.to,
    subject: `🟢 SUCCESS: Technical Assessment Scheduled - ${companyName}`,
    html: `
      <h2>New Appointment Scheduled!</h2>
      <p><strong>Contact Name:</strong> ${contactName}</p>
      <p><strong>Company Name:</strong> ${companyName}</p>
      <p><strong>Appointment Time:</strong> ${appointmentTime}</p>
      <hr />
      <h3>Phone Verification</h3>
      <p><strong>Original Caller ID:</strong> ${originalCallerId}</p>
      <p><strong>Confirmed Phone:</strong> ${confirmedPhone}</p>
      <p><strong>Status:</strong> ${matchStatus}</p>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    logger.info('Success email sent.');
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (interactionData, originalCallerId) => {
  if (!transporter || !config.email.to) {
    logger.warn('Email config missing, skipping report email');
    return;
  }

  const { reason, summary } = interactionData;

  const mailOptions = {
    from: `"Sarah (1Wire Assistant)" <${config.email.user}>`,
    to: config.email.to,
    subject: `🟠 REPORT: Interaction Logged - ${originalCallerId}`,
    html: `
      <h2>Call Interaction Report</h2>
      <p><strong>Original Caller ID:</strong> ${originalCallerId}</p>
      <p><strong>Reason:</strong> ${reason}</p>
      <p><strong>Summary:</strong> ${summary}</p>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    logger.info('Report email sent.');
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
