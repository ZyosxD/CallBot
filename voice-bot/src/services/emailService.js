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

export const sendEmail = async (type, data) => {
  try {
    let subject = '';
    let text = '';

    // Type: 'APPOINTMENT' (Green) or 'REPORT' (Orange)
    if (type === 'APPOINTMENT') {
      subject = `🟢 New Lead: ${data.companyName || 'Unknown Company'}`;
      text = `
        New Appointment Scheduled!

        Contact: ${data.name}
        Company: ${data.companyName}
        Phone: ${data.phone} (Verified: ${data.phoneVerified ? 'Yes' : 'No'})
        Twilio Caller ID: ${data.callerId}

        Date/Time: ${data.dateTime}
        Notes: ${data.notes || 'None'}
      `;
    } else if (type === 'REPORT') {
      subject = `🟠 Interaction Report: ${data.callerId}`;
      text = `
        Interaction Report

        Caller ID: ${data.callerId}
        Outcome: ${data.outcome}
        Notes: ${data.notes || 'None'}
      `;
    } else {
        logger.warn(`Unknown email type: ${type}`);
        return false;
    }

    const info = await transporter.sendMail({
      from: `"Sarah Bot" <${config.email.user}>`,
      to: config.email.notificationEmail,
      subject: subject,
      text: text,
    });

    logger.info(`Email sent: ${info.messageId}`);
    return true;
  } catch (error) {
    logger.error('Error sending email:', error);
    return false;
  }
};
