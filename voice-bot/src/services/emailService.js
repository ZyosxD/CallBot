import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: config.email.port,
  secure: false, // Use TLS or adjust based on your SMTP setup
  auth: {
    user: config.email.user,
    pass: config.email.pass,
  },
});

export const sendSuccessEmail = async (appointmentData) => {
  try {
    const { contactName, companyName, verifiedPhone, appointmentTime, originalCallerId } = appointmentData;

    const mailOptions = {
      from: config.email.from,
      to: config.email.to,
      subject: `🟢 SUCCESS: Appointment Scheduled - ${companyName}`,
      html: `
        <h2>New Technical Assessment Scheduled</h2>
        <p><strong>Contact Name:</strong> ${contactName}</p>
        <p><strong>Company Name:</strong> ${companyName}</p>
        <p><strong>Verified Phone:</strong> ${verifiedPhone}</p>
        <p><strong>Original CallerID:</strong> ${originalCallerId}</p>
        <p><strong>Appointment Time:</strong> ${appointmentTime}</p>
        <br/>
        <p><em>Please follow up accordingly.</em></p>
      `,
    };

    await transporter.sendMail(mailOptions);
    logger.info(`Success email sent for ${companyName}`);
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (interactionData) => {
  try {
    const { reason, originalCallerId, notes } = interactionData;

    const mailOptions = {
      from: config.email.from,
      to: config.email.to,
      subject: `🟠 REPORT: Interaction Logged - ${reason}`,
      html: `
        <h2>Interaction Report</h2>
        <p><strong>Reason:</strong> ${reason}</p>
        <p><strong>Original CallerID:</strong> ${originalCallerId}</p>
        <p><strong>Notes:</strong> ${notes || 'None'}</p>
      `,
    };

    await transporter.sendMail(mailOptions);
    logger.info(`Report email sent for reason: ${reason}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
