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

export const sendSuccessEmail = async (appointmentDetails) => {
  const { contactName, companyName, confirmedPhone, callerId, appointmentTime, needs } = appointmentDetails;

  const mailOptions = {
    from: `"1Wire AI System" <${config.email.user}>`,
    to: config.email.notificationEmail,
    subject: `🟢 SUCCESS: New Appointment with ${companyName}`,
    text: `
We have successfully scheduled a new appointment!

Details:
- Contact Name: ${contactName}
- Company Name: ${companyName}
- Appointment Time: ${appointmentTime}
- Needs Detected: ${needs || 'Not specified'}

Phone Verification:
- Verbally Confirmed Phone: ${confirmedPhone}
- Original Caller ID: ${callerId || 'Unknown'}

Please prepare for the Technical Assessment.
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    logger.info(`Success Email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (interactionDetails) => {
  const { contactName, companyName, confirmedPhone, callerId, reason, notes } = interactionDetails;

  const mailOptions = {
    from: `"1Wire AI System" <${config.email.user}>`,
    to: config.email.notificationEmail,
    subject: `🟠 REPORT: Interaction with ${companyName || 'Unknown Company'}`,
    text: `
An interaction has been concluded without an appointment.

Details:
- Contact Name: ${contactName || 'Not collected'}
- Company Name: ${companyName || 'Not collected'}
- Reason: ${reason}
- Notes: ${notes || 'None'}

Phone Verification:
- Verbally Confirmed Phone: ${confirmedPhone || 'Not collected'}
- Original Caller ID: ${callerId || 'Unknown'}

Please follow up if necessary.
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    logger.info(`Report Email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
