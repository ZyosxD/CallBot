import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

let transporter;
if (config.email && config.email.host && config.email.user && config.email.pass) {
  transporter = nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: config.email.port == 465, // true for 465, false for other ports
    auth: {
      user: config.email.user,
      pass: config.email.pass,
    },
  });
} else {
  logger.warn('SMTP configuration is missing. Emails will not be sent.');
}

export const sendSuccessEmail = async (details, callerId, confirmedPhone) => {
  if (!transporter) return;
  try {
    const info = await transporter.sendMail({
      from: `"1Wire Assistant" <${config.email.user}>`,
      to: config.email.to,
      subject: "🟢 SUCCESS: New Appointment Scheduled",
      text: `A new appointment has been scheduled.

Contact Name: ${details.contactName}
Company Name: ${details.companyName}
Twilio Caller ID: ${callerId}
Verbally Confirmed Phone: ${confirmedPhone}
Appointment Time: ${details.appointmentTime}

Details:
${JSON.stringify(details, null, 2)}
`,
    });
    logger.info(`Success email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (details, callerId, reason) => {
  if (!transporter) return;
  try {
    const info = await transporter.sendMail({
      from: `"1Wire Assistant" <${config.email.user}>`,
      to: config.email.to,
      subject: "🟠 REPORT: Interaction Logged",
      text: `An interaction has been reported.

Reason: ${reason}
Twilio Caller ID: ${callerId}

Details:
${JSON.stringify(details, null, 2)}
`,
    });
    logger.info(`Report email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};
