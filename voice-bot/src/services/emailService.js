import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: config.email.port,
  secure: config.email.secure,
  auth: {
    user: config.email.user,
    pass: config.email.pass,
  },
});

export const sendSuccessEmail = async (contactInfo, originalCallerId, verifiedPhone) => {
  try {
    const info = await transporter.sendMail({
      from: config.email.from,
      to: config.email.to,
      subject: `🟢 SUCCESS: Technical Assessment Scheduled with ${contactInfo.companyName}`,
      html: `
        <h2>New Technical Assessment Scheduled!</h2>
        <p><strong>Contact Name:</strong> ${contactInfo.contactName}</p>
        <p><strong>Company Name:</strong> ${contactInfo.companyName}</p>
        <p><strong>Appointment Time:</strong> ${contactInfo.appointmentTime}</p>
        <hr/>
        <h3>Phone Comparison</h3>
        <p><strong>Original Caller ID:</strong> ${originalCallerId}</p>
        <p><strong>Verbally Confirmed Phone:</strong> ${verifiedPhone}</p>
      `,
    });
    logger.info(`Success email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (interactionData, originalCallerId) => {
  try {
    const info = await transporter.sendMail({
      from: config.email.from,
      to: config.email.to,
      subject: `🟠 REPORT: Interaction Logged`,
      html: `
        <h2>Call Interaction Report</h2>
        <p><strong>Original Caller ID:</strong> ${originalCallerId}</p>
        <p><strong>Details:</strong></p>
        <pre>${JSON.stringify(interactionData, null, 2)}</pre>
      `,
    });
    logger.info(`Report email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
