import nodemailer from 'nodemailer';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: config.email.port,
  secure: false, // TLS
  auth: {
    user: config.email.user,
    pass: config.email.pass
  }
});

export const sendReportEmail = async (type, details) => {
  if (!config.email.notificationEmail) {
    logger.warn('Notification email not configured. Skipping email send.');
    return;
  }

  const isSuccess = type === 'SUCCESS';
  const subject = `${isSuccess ? '🟢 SUCCESS' : '🟠 REPORT'} - Call with ${details.contactName || 'Unknown'}`;

  const textBody = `
1Wire Call Report

Type: ${isSuccess ? 'Technical Assessment Scheduled' : 'Interaction Recorded'}
Contact Name: ${details.contactName || 'N/A'}
Company Name: ${details.companyName || 'N/A'}
Original Caller ID: ${details.originalCallerId}
Confirmed Phone: ${details.confirmedPhone || 'N/A'}
Appointment Time: ${details.appointmentTime || 'N/A'}
Notes/Summary: ${details.notes || 'N/A'}

CallerID VS Confirmed Phone Match: ${details.originalCallerId === details.confirmedPhone ? 'YES' : 'NO'}
  `;

  try {
    const info = await transporter.sendMail({
      from: `"Sarah AI" <${config.email.user}>`,
      to: config.email.notificationEmail,
      subject: subject,
      text: textBody,
    });
    logger.info(`Report email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
