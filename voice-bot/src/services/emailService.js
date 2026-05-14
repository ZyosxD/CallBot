import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: parseInt(config.email.port, 10),
  secure: config.email.port == 465, // true for 465, false for other ports
  auth: {
    user: config.email.user,
    pass: config.email.pass,
  },
});

export const sendSuccessEmail = async (appointmentData) => {
  const { name, company, verifiedPhone, callerId, appointmentTime, needs } = appointmentData;
  const mailOptions = {
    from: config.email.from,
    to: config.email.to,
    subject: '🟢 SUCCESS: New Technical Assessment Scheduled!',
    text: `A new appointment has been scheduled!

Details:
- Contact Name: ${name}
- Company Name: ${company}
- Verified Phone: ${verifiedPhone}
- Original Caller ID: ${callerId}
- Appointment Time: ${appointmentTime}
- Detected Needs: ${needs || 'None specified'}
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    logger.info(`Success email sent for appointment: ${name}`);
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (interactionData) => {
    const { status, callerId, notes } = interactionData;
    const mailOptions = {
        from: config.email.from,
        to: config.email.to,
        subject: `🟠 REPORT: Interaction outcome - ${status}`,
        text: `An interaction has completed without an appointment.

Details:
- Status: ${status}
- Original Caller ID: ${callerId}
- Notes: ${notes || 'None'}
        `
    };

    try {
        await transporter.sendMail(mailOptions);
        logger.info(`Report email sent for status: ${status}`);
    } catch (error) {
        logger.error('Error sending report email:', error);
    }
};