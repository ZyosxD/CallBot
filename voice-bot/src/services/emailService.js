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

export const sendSuccessEmail = async (leadData) => {
  try {
    const mailOptions = {
      from: config.email.from,
      to: config.email.to,
      subject: '🟢 SUCCESS: New Appointment Scheduled',
      text: `A new Technical Assessment appointment has been scheduled.

Details:
- Contact Name: ${leadData.contactName}
- Company Name: ${leadData.companyName}
- Verbally Confirmed Phone: ${leadData.confirmedPhone}
- Original Caller ID: ${leadData.originalCallerId}
- Appointment Time: ${leadData.appointmentTime}
- Call SID: ${leadData.callSid}

Please review the details above.`
    };
    await transporter.sendMail(mailOptions);
    logger.info('Success email sent');
  } catch (err) {
    logger.error('Error sending success email:', err);
  }
};

export const sendReportEmail = async (interactionData) => {
  try {
    const mailOptions = {
      from: config.email.from,
      to: config.email.to,
      subject: '🟠 REPORT: Interaction Logged',
      text: `An interaction was logged but no appointment was made.

Details:
- Reason: ${interactionData.reason}
- Call SID: ${interactionData.callSid}
- Original Caller ID: ${interactionData.originalCallerId}

Please review the logs for more information.`
    };
    await transporter.sendMail(mailOptions);
    logger.info('Report email sent');
  } catch (err) {
    logger.error('Error sending report email:', err);
  }
};
