import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: config.email.port,
  secure: config.email.port == 465, // true for 465, false for other ports
  auth: {
    user: config.email.user,
    pass: config.email.pass,
  },
});

export const sendSuccessEmail = async (appointmentData) => {
  try {
    const { contactName, companyName, confirmedPhone, callerId, appointmentTime } = appointmentData;

    const htmlContent = `
      <h2>Appointment Scheduled</h2>
      <p><strong>Contact Name:</strong> ${contactName}</p>
      <p><strong>Company Name:</strong> ${companyName}</p>
      <p><strong>Appointment Time:</strong> ${appointmentTime}</p>
      <br>
      <h3>Phone Comparison</h3>
      <p><strong>Verbally Confirmed Phone:</strong> ${confirmedPhone}</p>
      <p><strong>Twilio Caller ID:</strong> ${callerId}</p>
    `;

    const mailOptions = {
      from: config.email.from,
      to: config.email.to,
      subject: '🟢 SUCCESS: Technical Assessment Scheduled',
      html: htmlContent,
    };

    const info = await transporter.sendMail(mailOptions);
    logger.info(`Success email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (reportData) => {
  try {
    const { callerId, reason, details } = reportData;

    const htmlContent = `
      <h2>Interaction Report</h2>
      <p><strong>Reason:</strong> ${reason}</p>
      <p><strong>Details:</strong> ${details}</p>
      <br>
      <h3>Phone Information</h3>
      <p><strong>Twilio Caller ID:</strong> ${callerId}</p>
    `;

    const mailOptions = {
      from: config.email.from,
      to: config.email.to,
      subject: '🟠 REPORT: Interaction Update',
      html: htmlContent,
    };

    const info = await transporter.sendMail(mailOptions);
    logger.info(`Report email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
