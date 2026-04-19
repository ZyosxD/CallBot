import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: config.email.port,
  secure: config.email.port === 465,
  auth: {
    user: config.email.user,
    pass: config.email.pass
  }
});

export const sendReportEmail = async (type, callerId, confirmedPhone, data) => {
  try {
    let subject = '';
    let html = '';

    const phoneComparison = `
      <h3>Phone Verification</h3>
      <p><strong>Twilio Caller ID:</strong> ${callerId}</p>
      <p><strong>Confirmed Phone:</strong> ${confirmedPhone}</p>
      <p><em>Match:</em> ${callerId === confirmedPhone ? 'Yes' : 'No'}</p>
    `;

    if (type === 'SUCCESS') {
      subject = '🟢 SUCCESS: New Technical Assessment Scheduled';
      html = `
        <h2>New Appointment Scheduled!</h2>
        ${phoneComparison}
        <h3>Details</h3>
        <p><strong>Contact Name:</strong> ${data.contactName}</p>
        <p><strong>Company Name:</strong> ${data.companyName}</p>
        <p><strong>Appointment Time:</strong> ${data.appointmentTime}</p>
        <p><strong>Notes:</strong> ${data.notes || 'N/A'}</p>
      `;
    } else if (type === 'REPORT') {
      subject = '🟠 REPORT: Interaction Logged';
      html = `
        <h2>Interaction Report</h2>
        ${phoneComparison}
        <h3>Details</h3>
        <p><strong>Outcome:</strong> ${data.outcome}</p>
        <p><strong>Notes:</strong> ${data.notes || 'N/A'}</p>
      `;
    }

    const mailOptions = {
      from: config.email.from,
      to: config.email.to,
      subject,
      html
    };

    const info = await transporter.sendMail(mailOptions);
    logger.info(`Email sent: ${info.messageId}`);
    return true;
  } catch (error) {
    logger.error('Error sending email:', error);
    return false;
  }
};
