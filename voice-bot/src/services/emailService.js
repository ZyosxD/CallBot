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

export const sendSuccessEmail = async (details, callerId) => {
  const mailOptions = {
    from: config.email.user,
    to: config.email.to,
    subject: `🟢 SUCCESS - Technical Assessment Scheduled`,
    text: `
A new Technical Assessment has been scheduled.

Contact Details:
- Contact Name: ${details.contactName}
- Company Name: ${details.companyName}
- Verbally Confirmed Phone: ${details.confirmedPhone}
- Original Caller ID: ${callerId}

Appointment Details:
- Date/Time: ${details.appointmentTime}
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    logger.info('Success email sent.');
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (details, callerId) => {
  const mailOptions = {
    from: config.email.user,
    to: config.email.to,
    subject: `🟠 REPORT - Call Interaction Outcome`,
    text: `
A call has ended without scheduling an assessment.

Interaction Details:
- Original Caller ID: ${callerId}
- Reason/Outcome: ${details.reason}
- Additional Notes: ${details.notes || 'None'}
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    logger.info('Report email sent.');
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
