import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: config.email.port,
  secure: config.email.port == 465, // true for 465, false for other ports
  auth: {
    user: config.email.user,
    pass: config.email.pass,
  },
});

export const sendSuccessEmail = async (appointmentData, twilioCallerId) => {
  const mailOptions = {
    from: config.email.from,
    to: config.email.to,
    subject: '🟢 SUCCESS: New Technical Assessment Scheduled!',
    text: `
We have a new Technical Assessment scheduled!

Details:
Contact Name: ${appointmentData.name}
Company Name: ${appointmentData.company}
Verified Phone: ${appointmentData.verifiedPhone}
Appointment Time: ${appointmentData.time}
Notes: ${appointmentData.notes || 'None'}

Phone Verification:
- Twilio CallerID: ${twilioCallerId}
- Confirmed Verbally: ${appointmentData.verifiedPhone}
`,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    logger.info(`Success email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (interactionData, twilioCallerId) => {
  const mailOptions = {
    from: config.email.from,
    to: config.email.to,
    subject: '🟠 REPORT: Interaction Logged',
    text: `
An interaction was logged that did not result in an appointment.

Details:
Status: ${interactionData.status}
Summary: ${interactionData.summary}

Phone Details:
- Twilio CallerID: ${twilioCallerId}
`,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    logger.info(`Report email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
