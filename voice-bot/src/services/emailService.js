import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: parseInt(config.email.port, 10),
  secure: false, // true for 465, false for other ports
  auth: {
    user: config.email.user,
    pass: config.email.pass,
  },
});

export const sendSuccessEmail = async (details) => {
  const { contactName, companyName, confirmedPhone, appointmentTime, callerId, needs } = details;
  const mailOptions = {
    from: config.email.from,
    to: config.email.to,
    subject: '🟢 SUCCESS: New Technical Assessment Scheduled',
    text: `A new Technical Assessment has been scheduled!

Company Name: ${companyName}
Contact Name: ${contactName}
Appointment Time: ${appointmentTime}
Confirmed Phone (verbal): ${confirmedPhone}
Original Caller ID (Twilio): ${callerId}
Detected Needs: ${needs || 'N/A'}
`,
  };

  try {
    await transporter.sendMail(mailOptions);
    logger.info('Success email sent.');
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (details) => {
  const { reason, callerId, interactionNotes } = details;
  const mailOptions = {
    from: config.email.from,
    to: config.email.to,
    subject: '🟠 REPORT: Unsuccessful Interaction',
    text: `An interaction has been logged that requires attention or was unsuccessful.

Reason: ${reason}
Original Caller ID (Twilio): ${callerId}
Interaction Notes: ${interactionNotes || 'N/A'}
`,
  };

  try {
    await transporter.sendMail(mailOptions);
    logger.info('Report email sent.');
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
