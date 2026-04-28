import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: config.email.user,
    pass: config.email.pass
  }
});

export const sendSuccessEmail = async (contactName, companyName, confirmedPhone, callerId, appointmentTime) => {
  try {
    const mailOptions = {
      from: config.email.user,
      to: config.email.to,
      subject: `🟢 SUCCESS: Technical Assessment Scheduled - ${companyName}`,
      text: `A new Technical Assessment has been scheduled!

Contact Name: ${contactName}
Company Name: ${companyName}
Appointment Time: ${appointmentTime}

Phone Verification:
- Caller ID: ${callerId}
- Verbally Confirmed Phone: ${confirmedPhone}
`
    };

    await transporter.sendMail(mailOptions);
    logger.info('Success email sent for ' + companyName);
  } catch (error) {
    logger.error('Error sending success email: ' + error);
  }
};

export const sendReportEmail = async (callerId, reason, summary) => {
  try {
    const mailOptions = {
      from: config.email.user,
      to: config.email.to,
      subject: `🟠 REPORT: Interaction Logged - ${callerId}`,
      text: `An interaction was logged for ${callerId}.

Reason: ${reason}
Summary: ${summary}
`
    };

    await transporter.sendMail(mailOptions);
    logger.info('Report email sent for ' + callerId);
  } catch (error) {
    logger.error('Error sending report email: ' + error);
  }
};
