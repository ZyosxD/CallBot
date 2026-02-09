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

export const sendSuccessEmail = async (leadData) => {
  try {
    const mailOptions = {
      from: `"Sarah (1Wire)" <${config.email.user}>`,
      to: config.email.notificationEmail,
      subject: `✅ NEW APPOINTMENT: ${leadData.name} - ${leadData.company}`,
      html: `
        <h2 style="color: green;">New Technical Assessment Scheduled!</h2>
        <p><strong>Contact:</strong> ${leadData.name}</p>
        <p><strong>Company:</strong> ${leadData.company}</p>
        <p><strong>Phone (Verbal):</strong> ${leadData.phone}</p>
        <p><strong>Original CallerID:</strong> ${leadData.originalPhone || 'N/A'}</p>
        <p><strong>Date/Time:</strong> ${leadData.dateTime}</p>
        <br>
        <p><em>Please follow up immediately to confirm.</em></p>
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    logger.info(`Success email sent: ${info.messageId}`);
    return info;
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (reportData) => {
  try {
    const mailOptions = {
      from: `"Sarah (1Wire)" <${config.email.user}>`,
      to: config.email.notificationEmail,
      subject: `🔸 INTERACTION REPORT: ${reportData.result} - ${reportData.phone}`,
      html: `
        <h2 style="color: orange;">Call Report</h2>
        <p><strong>Result:</strong> ${reportData.result}</p>
        <p><strong>Phone:</strong> ${reportData.phone}</p>
        <p><strong>Notes:</strong> ${reportData.notes || 'No notes provided.'}</p>
        <br>
        <p><em>Check the interaction logs for more details.</em></p>
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    logger.info(`Report email sent: ${info.messageId}`);
    return info;
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
