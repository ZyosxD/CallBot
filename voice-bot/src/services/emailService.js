import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: false, // TLS
  auth: {
    user: config.smtp.user,
    pass: config.smtp.pass,
  },
});

export const sendSuccessEmail = async (leadData) => {
  try {
    const { contactName, companyName, confirmedPhone, appointmentTime, originalCallerId } = leadData;
    const mailOptions = {
      from: config.smtp.user,
      to: config.notificationEmail,
      subject: `🟢 SUCCESS: New Technical Assessment Scheduled - ${companyName}`,
      text: `
We have successfully scheduled a new Technical Assessment!

Contact Name: ${contactName}
Company Name: ${companyName}
Appointment Time: ${appointmentTime}
Confirmed Phone: ${confirmedPhone}
Original Caller ID: ${originalCallerId}

Best,
1Wire AI Caller (Sarah)
      `
    };
    await transporter.sendMail(mailOptions);
    logger.info(`Success email sent for ${companyName}`);
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (reportData) => {
  try {
    const { reason, originalCallerId } = reportData;
    const mailOptions = {
      from: config.smtp.user,
      to: config.notificationEmail,
      subject: `🟠 REPORT: Interaction Finished without Appointment`,
      text: `
An interaction just finished without scheduling an appointment.

Original Caller ID: ${originalCallerId}
Reason/Details: ${reason}

Best,
1Wire AI Caller (Sarah)
      `
    };
    await transporter.sendMail(mailOptions);
    logger.info(`Report email sent for ${originalCallerId}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
