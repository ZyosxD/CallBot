import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: parseInt(config.email.port, 10),
  secure: false, // Using TLS depending on the port config
  auth: {
    user: config.email.user,
    pass: config.email.pass,
  },
});

export const sendSuccessEmail = async (lead) => {
  try {
    const subject = `🟢 SUCCESS: New Appointment Scheduled - ${lead.companyName}`;
    const text = `
Hello Team,

A new technical assessment appointment has been scheduled by Sarah (1Wire AI).

Details:
- Contact Name: ${lead.contactName}
- Company Name: ${lead.companyName}
- Appointment Time: ${lead.appointmentTime}

Phone Verification:
- Original Caller ID: ${lead.callerId}
- Verbally Confirmed Phone: ${lead.confirmedPhone}

Call SID: ${lead.callSid}
Timestamp: ${lead.timestamp}

Best,
1Wire Assistant
`;

    const info = await transporter.sendMail({
      from: config.email.from,
      to: config.email.to,
      subject: subject,
      text: text,
    });

    logger.info(`Success email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending success email:', error);
  }
};

export const sendReportEmail = async (interaction) => {
  try {
    const subject = `🟠 REPORT: Call Interaction Logged - ${interaction.reason}`;
    const text = `
Hello Team,

Sarah (1Wire AI) has logged a call interaction.

Details:
- Reason: ${interaction.reason}
- Phone Number: ${interaction.callerId}

Call SID: ${interaction.callSid}
Timestamp: ${interaction.timestamp}

Best,
1Wire Assistant
`;

    const info = await transporter.sendMail({
      from: config.email.from,
      to: config.email.to,
      subject: subject,
      text: text,
    });

    logger.info(`Report email sent: ${info.messageId}`);
  } catch (error) {
    logger.error('Error sending report email:', error);
  }
};