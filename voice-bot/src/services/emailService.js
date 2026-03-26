import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: config.email.port,
  auth: {
    user: config.email.user,
    pass: config.email.pass,
  },
});

export const sendSuccessEmail = async (appointmentData, callerId) => {
  const { contactName, companyName, confirmedPhone, appointmentTime } = appointmentData;
  const to = config.email.to;

  const mailOptions = {
    from: config.email.user,
    to: to,
    subject: `🟢 SUCCESS: Technical Assessment Scheduled - ${companyName}`,
    text: `Great news! A new technical assessment has been scheduled.

Contact Name: ${contactName}
Company Name: ${companyName}
Confirmed Phone: ${confirmedPhone}
Original Caller ID: ${callerId}
Appointment Time: ${appointmentTime}

Comparison: ${confirmedPhone === callerId ? 'Matches' : 'Does Not Match'}

Needs detected: Internet, VoIP, and/or IT services.`,
  };

  try {
    await transporter.sendMail(mailOptions);
    logger.info(`Success email sent for ${companyName}`);
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (interactionData, callerId) => {
  const { reason, notes } = interactionData;
  const to = config.email.to;

  const mailOptions = {
    from: config.email.user,
    to: to,
    subject: `🟠 REPORT: Call Outcome - Action Required`,
    text: `A recent call resulted in the following outcome:

Original Caller ID: ${callerId}
Reason: ${reason}
Notes: ${notes || 'None'}

Please review this interaction.`,
  };

  try {
    await transporter.sendMail(mailOptions);
    logger.info(`Report email sent for caller ${callerId}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
