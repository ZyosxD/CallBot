import nodemailer from 'nodemailer';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

let transporter = null;

const createTransporter = () => {
  if (!transporter && config.email.smtpUser && config.email.smtpPass) {
    transporter = nodemailer.createTransport({
      host: config.email.smtpHost,
      port: config.email.smtpPort,
      secure: config.email.smtpPort === 465,
      auth: {
        user: config.email.smtpUser,
        pass: config.email.smtpPass
      }
    });
  }
  return transporter;
};

export const sendEmailNotification = async (isSuccess, data) => {
  try {
    const mailer = createTransporter();

    if (!mailer) {
      logger.warn('Email service not configured. Skipping email notification.');
      return;
    }

    const subject = isSuccess
      ? `🟢 SUCCESS: Technical Assessment Scheduled - ${data.companyName}`
      : `🟠 REPORT: Interaction Logged - ${data.reason}`;

    let htmlContent = `
      <h2>${isSuccess ? 'New Technical Assessment Scheduled' : 'Call Interaction Report'}</h2>
      <hr />
      <h3>Phone Verification</h3>
      <ul>
        <li><b>Twilio CallerID:</b> ${data.originalCallerId || 'Unknown'}</li>
        <li><b>Verbally Confirmed Number:</b> ${data.confirmedPhone || 'N/A'}</li>
      </ul>
      <hr />
    `;

    if (isSuccess) {
      htmlContent += `
        <h3>Assessment Details</h3>
        <ul>
          <li><b>Contact Name:</b> ${data.contactName}</li>
          <li><b>Company Name:</b> ${data.companyName}</li>
          <li><b>Appointment Time:</b> ${data.appointmentTime}</li>
          <li><b>Notes:</b> ${data.notes || 'None'}</li>
        </ul>
      `;
    } else {
      htmlContent += `
        <h3>Interaction Details</h3>
        <ul>
          <li><b>Reason:</b> ${data.reason}</li>
          <li><b>Details:</b> ${data.details || 'None'}</li>
        </ul>
      `;
    }

    const mailOptions = {
      from: `"Sarah 1Wire Assistant" <${config.email.smtpUser}>`,
      to: config.email.notifyTo || config.email.smtpUser,
      subject: subject,
      html: htmlContent
    };

    const info = await mailer.sendMail(mailOptions);
    logger.info(`Email sent successfully: ${info.messageId}`);

  } catch (error) {
    logger.error('Error sending email notification:', error);
  }
};
