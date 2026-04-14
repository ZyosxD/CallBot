import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: config.email.port,
  secure: false,
  auth: {
    user: config.email.user,
    pass: config.email.pass
  }
});

export const sendSuccessEmail = async (appointmentData) => {
  const { contactName, companyName, originalPhone, confirmedPhone, appointmentTime } = appointmentData;

  const mailOptions = {
    from: config.email.user,
    to: config.email.to,
    subject: '🟢 SUCCESS: New Technical Assessment Scheduled!',
    text: `A new technical assessment has been successfully scheduled.

Details:
Contact Name: ${contactName}
Company Name: ${companyName}
Original Phone (Caller ID): ${originalPhone}
Confirmed Phone: ${confirmedPhone}
Appointment Time: ${appointmentTime}
`
  };

  try {
    await transporter.sendMail(mailOptions);
    logger.info(`Success email sent for ${contactName}`);
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (interactionData) => {
  const { originalPhone, reason, transcript } = interactionData;

  const mailOptions = {
    from: config.email.user,
    to: config.email.to,
    subject: '🟠 REPORT: Interaction Ended',
    text: `An interaction has ended without scheduling an assessment.

Details:
Original Phone (Caller ID): ${originalPhone}
Reason: ${reason}
Transcript Summary:
${transcript}
`
  };

  try {
    await transporter.sendMail(mailOptions);
    logger.info(`Report email sent for ${originalPhone}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
